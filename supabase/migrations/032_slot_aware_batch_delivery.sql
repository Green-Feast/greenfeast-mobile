-- ============================================================
-- GreenFeast — Migration 032: Slot-aware batch delivery + double-decrement fix
-- Run AFTER 031_slot_cutoff.sql
--
-- Two changes, both to advance_batch_delivered (the RPC the admin's
-- Operations page calls to mark a batch delivered):
--
-- 1. Slot-aware: adds p_slot so lunch and dinner can be marked delivered
--    independently, matching the per-slot cutoffs from migration 031 and
--    the client's explicit ask for lunch/dinner to be tracked separately in
--    the admin. p_slot DEFAULT NULL preserves whole-day behaviour for any
--    stale caller still passing 2 args.
--
-- 2. Fixes a live double-decrement: the old version updated
--    subscriptions.deliveries_remaining unconditionally after setting
--    status='delivered', with no guard. wallet_debit is idempotent on
--    order_id so money was never at risk, but two concurrent presses (or a
--    double-click) both passed the cursor's status filter and both
--    decremented the counter. Splitting the button per-slot roughly doubles
--    the number of presses/day, so this needed fixing now, not later.
--    Fixed by making the status transition itself the gate: re-UPDATE with
--    a status guard and only touch the counter if that UPDATE actually
--    matched a row. The cursor's own `FOR UPDATE` already serialises
--    concurrent runs against the same order via Postgres's normal
--    row-locking + EvalPlanQual re-check; this is defense in depth on top
--    of that, not a replacement for it.
--
-- Also adds orders.skip_reason so an auto-pause-after-repeated-skips
-- feature (planned next) can tell a wallet-driven skip from a user-driven
-- one — user-initiated skips must never count toward auto-pause. Backfilled
-- to 'user' for all historical skipped rows so that feature never fires on
-- old data when it ships.
-- ============================================================

BEGIN;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS skip_reason TEXT
  CHECK (skip_reason IN ('user', 'insufficient_balance', 'pause', 'admin'));

UPDATE public.orders SET skip_reason = 'user'
 WHERE status = 'skipped' AND skip_reason IS NULL;

DROP FUNCTION IF EXISTS public.advance_batch_delivered(uuid, date);

CREATE FUNCTION public.advance_batch_delivered(
  p_batch uuid, p_date date, p_slot text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r         RECORD;
  v_total   integer;
  v_balance integer;
  v_billed  integer := 0;
  v_short   integer := 0;
  v_raced   integer := 0;
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
    v_total := COALESCE(r.cart_total, recompute_order_cart(r.order_id));

    SELECT COALESCE(balance, 0) INTO v_balance FROM wallets WHERE user_id = r.user_id;
    IF v_total > 0 AND COALESCE(v_balance, 0) < v_total THEN
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
END; $$;

REVOKE ALL ON FUNCTION public.advance_batch_delivered(uuid, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_batch_delivered(uuid, date, text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
