-- Migration 024: Bill the full cart for every order on delivery.
--
-- The app now treats the whole day as one cart billed ON DELIVERY: base meal,
-- extra portions (orders.quantity), extra dishes (extra_dish rows), add-ons
-- (order_addons kind='addon') and swap fees (order_addons kind='fee') are all
-- folded into orders.cart_total via recompute_order_cart and charged when the
-- meal is delivered. Nothing is charged at edit time anymore.
--
-- This redefines advance_batch_delivered to bill EVERY non-settled order
-- (dropping the migration 022 "skip extra_dish" branch, since extra dishes are
-- no longer prepaid). Wallet-insufficient orders are skipped + a notification
-- is written; the counter decrements by quantity only on a successful debit.

CREATE OR REPLACE FUNCTION public.advance_batch_delivered(p_batch uuid, p_date date)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r         RECORD;
  v_total   integer;
  v_balance integer;
  v_count   integer := 0;
BEGIN
  FOR r IN
    SELECT o.id AS order_id, o.user_id, o.subscription_id, o.quantity, o.cart_total
    FROM orders o
    WHERE o.batch_id      = p_batch
      AND o.delivery_date = p_date
      AND o.status NOT IN ('delivered', 'cancelled', 'skipped')
  LOOP
    -- Full cart cost: prefer the snapshot, else recompute live.
    IF r.cart_total IS NOT NULL THEN
      v_total := r.cart_total;
    ELSE
      v_total := recompute_order_cart(r.order_id);
    END IF;

    -- Wallet must cover the whole cart, else skip + notify (counter untouched).
    SELECT COALESCE(balance, 0) INTO v_balance FROM wallets WHERE user_id = r.user_id;
    IF v_total > 0 AND COALESCE(v_balance, 0) < v_total THEN
      UPDATE orders SET status = 'skipped', updated_at = now() WHERE id = r.order_id;
      INSERT INTO notifications (user_id, title, body, type)
      VALUES (r.user_id, 'Delivery skipped',
              'Your wallet didn''t cover ' || p_date::text || '. Top up to keep future deliveries.',
              'order_update');
      CONTINUE;
    END IF;

    UPDATE orders SET status = 'delivered', updated_at = now() WHERE id = r.order_id;

    UPDATE subscriptions
      SET deliveries_remaining = GREATEST(deliveries_remaining - COALESCE(r.quantity, 1), 0),
          updated_at = now()
      WHERE id = r.subscription_id;

    PERFORM wallet_debit(
      r.user_id,
      v_total,
      'Meal delivered ' || p_date::text,
      r.order_id::text
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END; $$;

NOTIFY pgrst, 'reload schema';
