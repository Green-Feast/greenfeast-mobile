-- ============================================================
-- GreenFeast — Migration 018: The Cart Model
-- Run in the Supabase SQL Editor.
--
-- Every delivery becomes an editable CART: one base meal (orders row) plus a
-- list of priced line items (order_addons rows). Line items are either:
--   * kind='addon' — a real add-on (FK addon_id), e.g. Extra Protein ×2
--   * kind='fee'   — a priced label with no catalogue row, e.g. "Meal switch" ₹20
--
-- Money rules (locked with the client):
--   * Base-meal rate stays plan-tier-derived (round(base_price/meals_total)),
--     snapshotted in orders.unit_price.
--   * cart_total (paise) = unit_price*quantity + Σ(line.unit_price*line.quantity).
--   * The wallet is debited the full cart_total ON DELIVERY.
--   * The meal counter (deliveries_remaining) decrements by the DEFAULT slot
--     quantity only (meals_lunch/meals_dinner) — extras are wallet-only.
--   * If the wallet can't cover the cart at delivery, the order is skipped +
--     a notification is written; the counter is left untouched.
-- ============================================================

-- ── order_addons → generic cart line items ──────────────────────────────────
ALTER TABLE public.order_addons
  ADD COLUMN IF NOT EXISTS quantity   SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS unit_price INTEGER,                 -- paise snapshot
  ADD COLUMN IF NOT EXISTS kind       TEXT NOT NULL DEFAULT 'addon'
                                       CHECK (kind IN ('addon', 'fee')),
  ADD COLUMN IF NOT EXISTS label      TEXT;                    -- for fee lines

-- Fee lines have no catalogue row, so addon_id must be nullable.
ALTER TABLE public.order_addons ALTER COLUMN addon_id DROP NOT NULL;

-- Backfill price snapshots for existing add-on rows from the catalogue.
UPDATE public.order_addons oa
   SET unit_price = a.price_per_meal
  FROM public.addons a
 WHERE oa.addon_id = a.id
   AND oa.unit_price IS NULL;

-- The old UNIQUE(order_id, addon_id) blocks NULL fee rows and quantity>1.
-- Replace it with a PARTIAL unique index: add-ons stay unique per order,
-- fee lines (addon_id IS NULL) are unconstrained.
ALTER TABLE public.order_addons
  DROP CONSTRAINT IF EXISTS order_addons_order_id_addon_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS order_addons_order_addon_uniq
  ON public.order_addons (order_id, addon_id)
  WHERE addon_id IS NOT NULL;

-- ── orders.cart_total ───────────────────────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cart_total INTEGER;  -- paise, full cart cost snapshot

-- ── recompute_order_cart: re-snapshot orders.cart_total from live line items ─
CREATE OR REPLACE FUNCTION public.recompute_order_cart(p_order uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_base  integer;
  v_lines integer;
  v_total integer;
BEGIN
  SELECT COALESCE(unit_price, 0) * COALESCE(quantity, 1)
    INTO v_base
    FROM orders WHERE id = p_order;

  SELECT COALESCE(SUM(COALESCE(unit_price, 0) * COALESCE(quantity, 1)), 0)
    INTO v_lines
    FROM order_addons WHERE order_id = p_order;

  v_total := COALESCE(v_base, 0) + COALESCE(v_lines, 0);
  UPDATE orders SET cart_total = v_total, updated_at = now() WHERE id = p_order;
  RETURN v_total;
END; $$;

-- Backfill cart_total for existing orders.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM orders LOOP
    PERFORM recompute_order_cart(r.id);
  END LOOP;
END $$;

-- ── advance_batch_delivered: debit the cart, decrement the DEFAULT count ─────
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
    SELECT o.id AS order_id, o.user_id, o.subscription_id,
           o.quantity, o.unit_price, o.cart_total
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
    v_balance := COALESCE(v_balance, 0);

    IF v_total > 0 AND v_balance < v_total THEN
      UPDATE orders SET status = 'skipped', updated_at = now() WHERE id = r.order_id;
      INSERT INTO notifications (user_id, title, body, type)
      VALUES (r.user_id, 'Delivery skipped',
              'Your wallet didn''t cover ' || p_date::text || '. Top up to keep future deliveries.',
              'order_update');
      CONTINUE;
    END IF;

    UPDATE orders SET status = 'delivered', updated_at = now() WHERE id = r.order_id;

    -- Counter counts BASE MEALS (orders.quantity) — default or extra alike.
    -- Add-ons and fee lines are wallet-only and never touch the counter.
    UPDATE subscriptions
      SET deliveries_remaining = GREATEST(deliveries_remaining - COALESCE(r.quantity, 1), 0),
          updated_at = now()
      WHERE id = r.subscription_id;

    -- Debit the full cart total (base + add-ons + fees) in one ledger row.
    PERFORM wallet_debit(r.user_id, v_total, 'Meal delivered ' || p_date::text, r.order_id::text);

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END; $$;

-- ── Grants (server-side callers only) ───────────────────────────────────────
REVOKE ALL ON FUNCTION public.recompute_order_cart(uuid)      FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_order_cart(uuid)   TO service_role;
REVOKE ALL ON FUNCTION public.advance_batch_delivered(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_batch_delivered(uuid, date) TO service_role;

NOTIFY pgrst, 'reload schema';
