-- ============================================================
-- GreenFeast — Migration 051: Test/Live mode, kitchen closures
-- ============================================================
-- 1. users.is_test: the admin works in Live mode (real customers) or Test
--    mode (everything before go-live, and test accounts made later). Every
--    existing account is test; new signups are live by default and can be
--    moved either way from the admin. Test accounts get GT- codes, so real
--    customers number from GF-000001.
-- 2. kitchen_closures: close the kitchen for a date + slot (holiday,
--    emergency). That slot's orders are cancelled unbilled
--    (skip_reason 'kitchen_closed'), customers are notified, and the nightly
--    job doesn't recreate them; the meal stays on the plan. Reopening revives
--    them while the slot is still open.
-- 3. advance_batch_delivered takes the admin's mode, so marking a batch
--    delivered in Live mode never bills test accounts in the same batch.
-- ============================================================

-- ── 1. Test / Live ───────────────────────────────────────────────────────────
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
UPDATE public.users SET is_test = true;
UPDATE public.users SET customer_code = 'GT-' || substr(customer_code, 4) WHERE customer_code LIKE 'GF-%';
ALTER SEQUENCE public.customer_code_seq RESTART WITH 1;
CREATE INDEX IF NOT EXISTS idx_users_is_test ON public.users (is_test);

-- Moving an account to Live gives it a real GF- number; GT- codes are test-only.
-- (Customers can't change is_test themselves: users UPDATE is column-limited since 045.)
CREATE OR REPLACE FUNCTION public.set_user_test_flag(p_user uuid, p_is_test boolean)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code text;
BEGIN
  UPDATE users SET is_test = p_is_test,
         customer_code = CASE
           WHEN NOT p_is_test AND customer_code LIKE 'GT-%'
             THEN 'GF-' || lpad(nextval('public.customer_code_seq')::text, 6, '0')
           ELSE customer_code END
   WHERE id = p_user
   RETURNING customer_code INTO v_code;
  RETURN v_code;
END; $$;
REVOKE ALL ON FUNCTION public.set_user_test_flag(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_test_flag(uuid, boolean) TO service_role;

-- ── 2. Kitchen closures ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kitchen_closures (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closed_on  date NOT NULL,
  meal_slot  text NOT NULL CHECK (meal_slot IN ('lunch', 'dinner')),
  reason     text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (closed_on, meal_slot)
);
ALTER TABLE public.kitchen_closures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_read_kitchen_closures ON public.kitchen_closures;
CREATE POLICY public_read_kitchen_closures ON public.kitchen_closures FOR SELECT USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.kitchen_closures FROM anon, authenticated;
GRANT ALL ON public.kitchen_closures TO service_role;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_skip_reason_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_skip_reason_check
  CHECK (skip_reason = ANY (ARRAY['user', 'insufficient_balance', 'pause', 'admin', 'plan_finished', 'kitchen_closed']));

CREATE OR REPLACE FUNCTION public.close_kitchen(
  p_date date, p_slot text, p_reason text, p_admin uuid, p_notify boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cancelled integer := 0;
  v_users     integer := 0;
  v_day       text := trim(to_char(p_date, 'Day')) || ', ' || to_char(p_date, 'FMDD Mon');
  v_reason    text := NULLIF(trim(COALESCE(p_reason, '')), '');
  u           record;
BEGIN
  IF p_slot NOT IN ('lunch', 'dinner') THEN
    RAISE EXCEPTION 'close_kitchen: invalid slot %', p_slot;
  END IF;
  IF p_date < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'close_kitchen: date is in the past';
  END IF;

  INSERT INTO kitchen_closures (closed_on, meal_slot, reason, created_by)
  VALUES (p_date, p_slot, v_reason, p_admin)
  ON CONFLICT (closed_on, meal_slot) DO UPDATE SET reason = EXCLUDED.reason;

  FOR u IN
    SELECT DISTINCT user_id FROM orders
     WHERE delivery_date = p_date AND meal_slot = p_slot
       AND status IN ('scheduled', 'confirmed', 'preparing')
  LOOP
    IF p_notify THEN
      PERFORM notify_user(
        u.user_id,
        'No ' || p_slot || ' on ' || v_day,
        'Our kitchen is closed for ' || p_slot || ' on ' || v_day
          || COALESCE(' (' || v_reason || ')', '')
          || '. You won''t be charged, and the meal stays on your plan.',
        'custom');
    END IF;
    v_users := v_users + 1;
  END LOOP;

  UPDATE orders SET status = 'cancelled', skip_reason = 'kitchen_closed', updated_at = now()
   WHERE delivery_date = p_date AND meal_slot = p_slot
     AND status IN ('scheduled', 'confirmed', 'preparing');
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  RETURN jsonb_build_object('cancelled', v_cancelled, 'customers', v_users, 'notified', p_notify);
END; $$;
REVOKE ALL ON FUNCTION public.close_kitchen(date, text, text, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_kitchen(date, text, text, uuid, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.reopen_kitchen(p_date date, p_slot text, p_notify boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_revived integer := 0;
  v_users   integer := 0;
  v_day     text := trim(to_char(p_date, 'Day')) || ', ' || to_char(p_date, 'FMDD Mon');
  u         record;
BEGIN
  DELETE FROM kitchen_closures WHERE closed_on = p_date AND meal_slot = p_slot;

  -- Only while the slot is still open: after its cutoff the kitchen has
  -- planned without these meals.
  IF is_slot_locked(p_date, p_slot) THEN
    RETURN jsonb_build_object('revived', 0, 'customers', 0, 'note', 'slot already past cutoff');
  END IF;

  FOR u IN
    SELECT DISTINCT o.user_id FROM orders o
      JOIN subscriptions s ON s.id = o.subscription_id
     WHERE o.delivery_date = p_date AND o.meal_slot = p_slot
       AND o.status = 'cancelled' AND o.skip_reason = 'kitchen_closed'
       AND s.status IN ('active', 'pending')
  LOOP
    IF p_notify THEN
      PERFORM notify_user(
        u.user_id,
        'Kitchen open on ' || v_day,
        'Good news — we''re open for ' || p_slot || ' on ' || v_day || ' after all, and your meal is back on.',
        'custom');
    END IF;
    v_users := v_users + 1;
  END LOOP;

  UPDATE orders o SET status = 'scheduled', skip_reason = NULL, updated_at = now()
    FROM subscriptions s
   WHERE s.id = o.subscription_id
     AND o.delivery_date = p_date AND o.meal_slot = p_slot
     AND o.status = 'cancelled' AND o.skip_reason = 'kitchen_closed'
     AND s.status IN ('active', 'pending');
  GET DIAGNOSTICS v_revived = ROW_COUNT;

  RETURN jsonb_build_object('revived', v_revived, 'customers', v_users);
END; $$;
REVOKE ALL ON FUNCTION public.reopen_kitchen(date, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_kitchen(date, text, boolean) TO service_role;

-- ── 3. Batch delivery respects Test/Live ─────────────────────────────────────
DROP FUNCTION IF EXISTS public.advance_batch_delivered(uuid, date, text);
CREATE FUNCTION public.advance_batch_delivered(p_batch uuid, p_date date, p_slot text DEFAULT NULL::text, p_is_test boolean DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r         RECORD;
  v_total   integer;
  v_balance integer;
  v_billed  integer := 0;
  v_short   integer := 0;
  v_raced   integer := 0;
  v_cod_pending boolean;
BEGIN
  -- A typo like 'Lunch' must not silently match zero rows and report success.
  IF p_slot IS NOT NULL AND p_slot NOT IN ('lunch', 'dinner') THEN
    RAISE EXCEPTION 'advance_batch_delivered: invalid p_slot %', p_slot;
  END IF;

  FOR r IN
    SELECT o.id AS order_id, o.user_id, o.subscription_id,
           o.quantity, o.cart_total, o.meal_slot
      FROM orders o
     WHERE o.batch_id      = p_batch
       AND o.delivery_date = p_date
       AND (p_slot IS NULL OR o.meal_slot = p_slot)
       AND o.status NOT IN ('delivered', 'cancelled', 'skipped')
       -- Admin Test/Live mode: only that side's customers (NULL = everyone).
       AND (p_is_test IS NULL OR EXISTS (
             SELECT 1 FROM users u WHERE u.id = o.user_id AND u.is_test = p_is_test))
     ORDER BY o.user_id, o.meal_slot, o.slot_seq
       FOR UPDATE OF o
  LOOP
    -- Always recompute: cart_total is only a display snapshot (see 044 header).
    v_total := recompute_order_cart(r.order_id);

    -- CoD plans still waiting for their cash are delivered on credit.
    SELECT (s.status = 'pending' AND s.payment_method = 'cod') INTO v_cod_pending
      FROM subscriptions s WHERE s.id = r.subscription_id;

    SELECT COALESCE(balance, 0) INTO v_balance FROM wallets WHERE user_id = r.user_id FOR UPDATE;
    IF v_total > 0 AND COALESCE(v_balance, 0) < v_total AND NOT COALESCE(v_cod_pending, false) THEN
      UPDATE orders SET status = 'skipped', skip_reason = 'insufficient_balance', updated_at = now()
       WHERE id = r.order_id;
      INSERT INTO notifications (user_id, title, body, type) VALUES (
        r.user_id, 'Delivery skipped',
        'Your wallet didn''t cover ' || p_date::text || '''s ' || r.meal_slot ||
        '. Top up to keep future deliveries.', 'order_update');
      v_short := v_short + 1;
      CONTINUE;
    END IF;

    -- The status transition IS the guard: only the caller that actually
    -- performs this update gets to decrement the counter and debit.
    UPDATE orders SET status = 'delivered', updated_at = now()
     WHERE id = r.order_id AND status NOT IN ('delivered', 'cancelled', 'skipped');
    IF NOT FOUND THEN
      v_raced := v_raced + 1;
      CONTINUE;
    END IF;

    UPDATE subscriptions
       SET deliveries_remaining = GREATEST(deliveries_remaining - COALESCE(r.quantity, 1), 0),
           updated_at = now()
     WHERE id = r.subscription_id;

    PERFORM wallet_debit(
      r.user_id, v_total,
      'Meal delivered ' || p_date::text || ' ' || r.meal_slot, r.order_id::text
    );

    v_billed := v_billed + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'billed', v_billed,
    'skipped_insufficient', v_short,
    'already_settled', v_raced
  );
END; $function$;
REVOKE ALL ON FUNCTION public.advance_batch_delivered(uuid, date, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_batch_delivered(uuid, date, text, boolean) TO service_role;
