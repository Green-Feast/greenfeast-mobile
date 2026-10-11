-- ============================================================
-- GreenFeast — Migration 044: Phase 1 security lockdown
-- ============================================================
-- Found in the 2026-10-11 audit. All server-side; the app needs no update.
--
-- 1. orders: customers could UPDATE every column of their own orders through
--    the public API, including cart_total, which delivery billing charged —
--    setting it to 0 made every delivery free — and status (mark your own
--    order delivered so it's never billed, or skip after the cutoff). The
--    app only ever changes address_id (My Plan day modal); everything else
--    goes through edge functions, which run as service_role.
-- 2. order_addons: same. Cart lines, including swap fees, are written only by
--    edge functions; the ALL policy let customers delete their own fee lines
--    or insert lines at any price.
-- 3. Delivery billing always recomputes the price instead of trusting the
--    stored cart_total, and locks the wallet row while checking the balance.
-- 4. Cash-on-delivery plans still waiting for their cash are delivered on
--    credit. Their wallet is no longer funded at signup (that was free wallet
--    money for anyone who picked CoD); the admin's "Mark cash received"
--    credits it. Without this the first delivery — where the cash is
--    collected — would bounce as insufficient balance. The wallet can go
--    negative until the cash is marked received, which shows as debt.
-- ============================================================

-- 1. orders: address changes only, and only while the slot is still open.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.orders FROM anon, authenticated;
GRANT UPDATE (address_id) ON public.orders TO authenticated;

-- Defense in depth for the one column customers can still write: only on a
-- not-yet-locked, not-yet-dispatched order, and only to one of their own
-- addresses. Applies to customer sessions only (edge functions and the admin
-- app run as service_role).
CREATE OR REPLACE FUNCTION public.guard_customer_order_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;
  IF NEW.address_id IS DISTINCT FROM OLD.address_id THEN
    IF OLD.status NOT IN ('scheduled', 'confirmed')
       OR is_slot_locked(OLD.delivery_date, OLD.meal_slot) THEN
      RAISE EXCEPTION 'This delivery can no longer be changed'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.address_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM addresses a WHERE a.id = NEW.address_id AND a.user_id = OLD.user_id
    ) THEN
      RAISE EXCEPTION 'Address not found' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS orders_guard_customer_update ON public.orders;
CREATE TRIGGER orders_guard_customer_update
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_customer_order_update();

-- 2. order_addons: edge functions only.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.order_addons FROM anon, authenticated;

-- 3 + 4. Billing. (CREATE OR REPLACE keeps the existing EXECUTE grants, which
-- exclude anon/authenticated.)

CREATE OR REPLACE FUNCTION public.advance_order_delivered(p_order uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r         RECORD;
  v_total   integer;
  v_balance integer;
  v_cod_pending boolean;
BEGIN
  SELECT o.id AS order_id, o.user_id, o.subscription_id,
         o.quantity, o.cart_total, o.meal_slot, o.delivery_date
    INTO r
    FROM orders o
   WHERE o.id = p_order
     AND o.status NOT IN ('delivered', 'cancelled', 'skipped')
     FOR UPDATE OF o;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'already_settled');
  END IF;

  -- Always recompute: cart_total is only a display snapshot and must never be
  -- the billed amount (customers could write it directly before 044).
  v_total := recompute_order_cart(r.order_id);

  -- CoD plans still waiting for their cash are delivered on credit (the first
  -- delivery is where the cash is collected; "Mark cash received" settles it).
  SELECT (s.status = 'pending' AND s.payment_method = 'cod') INTO v_cod_pending
    FROM subscriptions s WHERE s.id = r.subscription_id;

  -- Row lock so two deliveries for the same customer can't both pass the
  -- balance check and overdraw the wallet.
  SELECT COALESCE(balance, 0) INTO v_balance FROM wallets WHERE user_id = r.user_id FOR UPDATE;
  IF v_total > 0 AND COALESCE(v_balance, 0) < v_total AND NOT COALESCE(v_cod_pending, false) THEN
    UPDATE orders SET status = 'skipped', skip_reason = 'insufficient_balance', updated_at = now()
     WHERE id = r.order_id;
    INSERT INTO notifications (user_id, title, body, type) VALUES (
      r.user_id, 'Delivery skipped',
      'Your wallet didn''t cover ' || r.delivery_date::text || '''s ' || r.meal_slot ||
      '. Top up to keep future deliveries.', 'order_update');
    RETURN jsonb_build_object('result', 'skipped_insufficient');
  END IF;

  -- The status transition IS the guard, same as advance_batch_delivered.
  UPDATE orders SET status = 'delivered', updated_at = now()
   WHERE id = r.order_id AND status NOT IN ('delivered', 'cancelled', 'skipped');
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'already_settled');
  END IF;

  UPDATE subscriptions
     SET deliveries_remaining = GREATEST(deliveries_remaining - COALESCE(r.quantity, 1), 0),
         updated_at = now()
   WHERE id = r.subscription_id;

  PERFORM wallet_debit(
    r.user_id, v_total,
    'Meal delivered ' || r.delivery_date::text || ' ' || r.meal_slot, r.order_id::text
  );

  RETURN jsonb_build_object('result', 'billed');
END; $function$;

CREATE OR REPLACE FUNCTION public.advance_batch_delivered(p_batch uuid, p_date date, p_slot text DEFAULT NULL::text)
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
