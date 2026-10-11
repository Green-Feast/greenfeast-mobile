-- ============================================================
-- GreenFeast — Migration 048: plan renewals
-- ============================================================
-- A plan is finished when its meal counter (deliveries_remaining) reaches 0.
-- Renewing — repeat the same plan, edit it, or redo onboarding — creates a
-- NEW subscription that's activated by its Cashfree payment, exactly like a
-- first purchase. When it activates, the customer's finished plan is retired.
--
-- 1. subscriptions.renewed_from: which plan a renewal continues (history).
-- 2. Skip reason 'plan_finished'.
-- 3. retire_previous_subscriptions(new_sub): the customer's other plans with
--    no meals left become 'expired', their remaining future orders are
--    cancelled (today's past-cutoff slots are left alone — already cooked),
--    and the new plan inherits their batch assignment if it has none.
-- 4. The cutoff check also stops meals once a plan's meals are used up. Order
--    creation stops at the counter too (instantiate-orders); this catches
--    orders created before that, and plans whose counter was lowered.
-- ============================================================

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS renewed_from uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_skip_reason_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_skip_reason_check
  CHECK (skip_reason = ANY (ARRAY['user', 'insufficient_balance', 'pause', 'admin', 'plan_finished']));

CREATE OR REPLACE FUNCTION public.retire_previous_subscriptions(p_new_sub uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user  uuid;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  old     record;
  n       integer := 0;
BEGIN
  SELECT user_id INTO v_user FROM subscriptions WHERE id = p_new_sub;
  IF v_user IS NULL THEN RETURN 0; END IF;

  FOR old IN
    SELECT id, batch_id_lunch, batch_id_dinner
      FROM subscriptions
     WHERE user_id = v_user
       AND id <> p_new_sub
       AND status IN ('active', 'paused')
       AND deliveries_remaining <= 0
     ORDER BY created_at DESC
  LOOP
    UPDATE subscriptions SET status = 'expired', updated_at = now() WHERE id = old.id;

    UPDATE orders SET status = 'cancelled', updated_at = now()
     WHERE subscription_id = old.id
       AND status IN ('scheduled', 'confirmed')
       AND (delivery_date > v_today
            OR (delivery_date = v_today AND NOT is_slot_locked(delivery_date, meal_slot)));

    UPDATE subscriptions
       SET batch_id_lunch  = COALESCE(batch_id_lunch, old.batch_id_lunch),
           batch_id_dinner = COALESCE(batch_id_dinner, old.batch_id_dinner)
     WHERE id = p_new_sub;

    n := n + 1;
  END LOOP;
  RETURN n;
END; $$;
REVOKE ALL ON FUNCTION public.retire_previous_subscriptions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retire_previous_subscriptions(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_slot_balance(p_slot text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today     date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  u           record;
  ord         record;
  v_available integer;
  v_cost      integer;
  v_finished  boolean;
  v_broke     boolean;
  v_done      boolean;
  v_skipped   integer := 0;
  v_users     integer := 0;
BEGIN
  IF p_slot NOT IN ('lunch', 'dinner') THEN
    RAISE EXCEPTION 'enforce_slot_balance: invalid slot %', p_slot;
  END IF;

  FOR u IN
    SELECT DISTINCT o.user_id
      FROM orders o
      JOIN subscriptions s ON s.id = o.subscription_id
     WHERE o.delivery_date = v_today
       AND o.meal_slot = p_slot
       AND o.status IN ('scheduled', 'confirmed')
       AND NOT (s.status = 'pending' AND s.payment_method = 'cod')
  LOOP
    SELECT COALESCE(balance, 0) INTO v_available FROM wallets WHERE user_id = u.user_id FOR UPDATE;
    v_available := COALESCE(v_available, 0);
    -- At the dinner cutoff, today's lunch may not be billed yet.
    IF p_slot = 'dinner' THEN
      v_available := v_available - unbilled_today(u.user_id, 'lunch');
    END IF;

    v_broke := false;
    v_done  := false;
    -- Base meal first, extras after, so a short wallet drops the extras first.
    FOR ord IN
      SELECT id, subscription_id FROM orders
       WHERE user_id = u.user_id AND delivery_date = v_today AND meal_slot = p_slot
         AND status IN ('scheduled', 'confirmed')
       ORDER BY extra_dish, slot_seq, created_at
    LOOP
      -- Plan's meals used up (pending CoD plans are exempt: not activated yet).
      SELECT (s.deliveries_remaining <= 0 AND NOT (s.status = 'pending' AND s.payment_method = 'cod'))
        INTO v_finished FROM subscriptions s WHERE s.id = ord.subscription_id;
      IF COALESCE(v_finished, false) THEN
        UPDATE orders SET status = 'skipped', skip_reason = 'plan_finished', updated_at = now()
         WHERE id = ord.id;
        v_skipped := v_skipped + 1;
        v_done := true;
        CONTINUE;
      END IF;

      v_cost := recompute_order_cart(ord.id);
      IF v_cost <= v_available THEN
        v_available := v_available - v_cost;
      ELSE
        UPDATE orders SET status = 'skipped', skip_reason = 'insufficient_balance', updated_at = now()
         WHERE id = ord.id;
        v_skipped := v_skipped + 1;
        v_broke := true;
      END IF;
    END LOOP;

    IF v_done THEN
      PERFORM notify_user(
        u.user_id,
        'Your plan has finished',
        'All the meals on your plan have been used, so today''s ' || p_slot || ' wasn''t prepared. '
          || 'Renew your plan in the app to keep your meals coming.',
        'custom');
    ELSIF v_broke THEN
      PERFORM notify_user(
        u.user_id,
        'Today''s ' || p_slot || ' was skipped',
        'Your wallet didn''t cover today''s ' || p_slot || ', so it wasn''t prepared. '
          || 'Top up in the app to keep your next meals coming.',
        'custom');
    END IF;
    IF v_done OR v_broke THEN
      v_users := v_users + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('slot', p_slot, 'skipped', v_skipped, 'users', v_users);
END; $$;
REVOKE ALL ON FUNCTION public.enforce_slot_balance(text) FROM PUBLIC, anon, authenticated;
