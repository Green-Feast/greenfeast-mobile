-- ============================================================
-- GreenFeast — Migration 046: fix enforce_slot_balance
-- ============================================================
-- 045's loop variable `o` shadowed the `orders o` alias in its own query
-- ("record o is not assigned yet"), so the cutoff check errored. Renamed.
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_slot_balance(p_slot text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today     date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  u           record;
  ord         record;
  v_available integer;
  v_cost      integer;
  v_hit       boolean;
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

    v_hit := false;
    -- Base meal first, extras after, so a short wallet drops the extras first.
    FOR ord IN
      SELECT id FROM orders
       WHERE user_id = u.user_id AND delivery_date = v_today AND meal_slot = p_slot
         AND status IN ('scheduled', 'confirmed')
       ORDER BY extra_dish, slot_seq, created_at
    LOOP
      v_cost := recompute_order_cart(ord.id);
      IF v_cost <= v_available THEN
        v_available := v_available - v_cost;
      ELSE
        UPDATE orders SET status = 'skipped', skip_reason = 'insufficient_balance', updated_at = now()
         WHERE id = ord.id;
        v_skipped := v_skipped + 1;
        v_hit := true;
      END IF;
    END LOOP;

    IF v_hit THEN
      PERFORM notify_user(
        u.user_id,
        'Today''s ' || p_slot || ' was skipped',
        'Your wallet didn''t cover today''s ' || p_slot || ', so it wasn''t prepared. '
          || 'Top up in the app to keep your next meals coming.',
        'custom');
      v_users := v_users + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('slot', p_slot, 'skipped', v_skipped, 'users', v_users);
END; $$;
