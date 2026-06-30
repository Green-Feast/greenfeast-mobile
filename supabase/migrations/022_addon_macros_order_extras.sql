-- ============================================================
-- GreenFeast — Migration 022: Add-on macros + order extras
-- Builds on 018 (cart model) and 019 (lat/lng already added).
-- Run in Supabase SQL Editor.
-- ============================================================

-- ── 1. Add-on macros ─────────────────────────────────────────────────────────
-- Per-add-on macro contributions on top of a base meal. Estimates — refine later.
ALTER TABLE public.addons
  ADD COLUMN IF NOT EXISTS kcal    INTEGER,
  ADD COLUMN IF NOT EXISTS protein NUMERIC,
  ADD COLUMN IF NOT EXISTS carbs   NUMERIC,
  ADD COLUMN IF NOT EXISTS fat     NUMERIC;

UPDATE public.addons SET kcal = 60,  protein = 10, carbs = 1,  fat = 2 WHERE id = 'extra-protein';
UPDATE public.addons SET kcal = 50,  protein = 2,  carbs = 3,  fat = 4 WHERE id = 'seeds';
UPDATE public.addons SET kcal = 60,  protein = 0,  carbs = 2,  fat = 6 WHERE id = 'extra-dressing';
UPDATE public.addons SET kcal = 80,  protein = 1,  carbs = 20, fat = 0 WHERE id = 'exotic-fruits';
UPDATE public.addons SET kcal = 180, protein = 6,  carbs = 30, fat = 3 WHERE id = 'smoothie';
UPDATE public.addons SET kcal = 90,  protein = 5,  carbs = 1,  fat = 7 WHERE id = 'cheese';

-- ── 2. Order-level swap fee + extra dishes ───────────────────────────────────
-- switch_fee_paise: the ₹20 swap fee recorded on the order row so the app can
--   display it in the cart. The fee is debited from the wallet by switch-meal.
-- extra_dish: TRUE for a second dish added to a slot via the add-dish flow.
--   It is PREPAID at add time, so advance_batch_delivered must not bill it again.
-- slot_seq: allows multiple dishes per slot (primary = 0, added = 1, 2, …).
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS switch_fee_paise INTEGER  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extra_dish       BOOLEAN  NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS slot_seq         SMALLINT NOT NULL DEFAULT 0;

-- The old unique key (subscription_id, delivery_date, meal_slot) blocks a second
-- dish in the same slot. Replace it with one that includes slot_seq.
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_subscription_delivery_slot_unique;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_subscription_delivery_slot_seq_unique'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_subscription_delivery_slot_seq_unique
        UNIQUE (subscription_id, delivery_date, meal_slot, slot_seq);
  END IF;
END $$;

-- ── 3. Redefine advance_batch_delivered ──────────────────────────────────────
-- Builds on migration 018's cart_total model:
--   * Uses cart_total snapshot (includes base + add-on lines + swap fee).
--   * Skips delivery if wallet balance is insufficient (writes a notification).
--   * Skips billing/counter for extra_dish rows (already paid at add time).
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
           o.quantity, o.unit_price, o.cart_total, o.extra_dish
    FROM orders o
    WHERE o.batch_id      = p_batch
      AND o.delivery_date = p_date
      AND o.status NOT IN ('delivered', 'cancelled', 'skipped')
  LOOP
    -- Extra dishes are prepaid — mark delivered only, never re-bill or decrement.
    IF r.extra_dish THEN
      UPDATE orders SET status = 'delivered', updated_at = now() WHERE id = r.order_id;
      v_count := v_count + 1;
      CONTINUE;
    END IF;

    -- Full cart cost: prefer snapshot, else recompute live.
    IF r.cart_total IS NOT NULL THEN
      v_total := r.cart_total;
    ELSE
      v_total := recompute_order_cart(r.order_id);
    END IF;

    -- Skip if wallet can't cover; write notification so the user knows.
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
