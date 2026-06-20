-- Migration 017: Per-order quantity and unit price snapshot
-- quantity: how many meals this order represents (e.g. 2 lunches → quantity=2)
-- unit_price: per-meal price in paise, snapshotted at instantiation so billing
--             never recomputes against a since-changed plan or add-ons.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS quantity   SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS unit_price INTEGER;

-- Replace advance_batch_delivered to honour quantity and use stored unit_price.
CREATE OR REPLACE FUNCTION public.advance_batch_delivered(p_batch uuid, p_date date)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r          RECORD;
  v_addon    integer;
  v_per_meal integer;
  v_count    integer := 0;
BEGIN
  FOR r IN
    SELECT o.id AS order_id, o.user_id, o.subscription_id,
           o.quantity, o.unit_price,
           p.base_price, p.meals_total
    FROM orders o
    JOIN subscriptions s ON s.id = o.subscription_id
    JOIN plans p         ON p.id = s.plan_id
    WHERE o.batch_id    = p_batch
      AND o.delivery_date = p_date
      AND o.status NOT IN ('delivered', 'cancelled', 'skipped')
  LOOP
    -- Use snapshotted unit_price when available; fall back to live computation.
    IF r.unit_price IS NOT NULL THEN
      v_per_meal := r.unit_price;
    ELSE
      SELECT COALESCE(SUM(a.price_per_meal), 0) INTO v_addon
      FROM subscription_addons sa JOIN addons a ON a.id = sa.addon_id
      WHERE sa.subscription_id = r.subscription_id;

      v_per_meal := ROUND(r.base_price::numeric / NULLIF(r.meals_total, 0)) + COALESCE(v_addon, 0);
    END IF;

    UPDATE orders SET status = 'delivered', updated_at = now() WHERE id = r.order_id;

    -- Decrement by quantity so a 2-lunch order burns 2 deliveries.
    UPDATE subscriptions
      SET deliveries_remaining = GREATEST(deliveries_remaining - r.quantity, 0),
          updated_at = now()
      WHERE id = r.subscription_id;

    -- Debit quantity × unit_price in a single ledger row.
    PERFORM wallet_debit(
      r.user_id,
      v_per_meal * r.quantity,
      'Meal delivered ' || p_date::text,
      r.order_id::text
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END; $$;

NOTIFY pgrst, 'reload schema';
