-- ============================================================
-- GreenFeast — Migration 036: single-order delivery advance
--
-- The Operations page is gaining per-subscriber status buttons alongside
-- the existing per-batch bulk buttons — marking one person delivered
-- shouldn't require advancing their whole batch. This mirrors
-- advance_batch_delivered's logic (031/032) exactly — same insufficient-
-- balance skip, same status-transition-is-the-guard double-decrement
-- protection, same wallet_debit idempotency key — just scoped to one order
-- instead of a batch/date/slot cursor, so the two never diverge in billing
-- behaviour.
-- ============================================================

CREATE FUNCTION public.advance_order_delivered(p_order uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r         RECORD;
  v_total   integer;
  v_balance integer;
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

  v_total := COALESCE(r.cart_total, recompute_order_cart(r.order_id));

  SELECT COALESCE(balance, 0) INTO v_balance FROM wallets WHERE user_id = r.user_id;
  IF v_total > 0 AND COALESCE(v_balance, 0) < v_total THEN
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
END; $$;

REVOKE ALL ON FUNCTION public.advance_order_delivered(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_order_delivered(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
