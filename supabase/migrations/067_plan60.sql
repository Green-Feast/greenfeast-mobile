-- ============================================================
-- GreenFeast — Migration 067: the 60-meal plan
-- ============================================================
-- 60 meals at ₹239 a meal = ₹14,340 (plan_meal_rate = 23900 exactly).
-- Coupons allowed (066). Online payment only in the app: plans.allow_cod
-- (new) says whether the app offers cash on delivery for a plan —
-- cashfree-create-order refuses it otherwise. The admin can still set up a
-- cash plan by hand (Users → Create subscription).
--
-- Inserted inactive: the app update that knows this plan ships first, then
-- the plan is switched on (UPDATE plans SET is_active = true WHERE id = 'plan60').
-- ============================================================

ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS allow_cod boolean NOT NULL DEFAULT true;

INSERT INTO public.plans (id, name, meals_total, days_per_week, base_price, is_active, allow_coupons, allow_cod)
VALUES ('plan60', '60-Meal Plan', 60, 6, 1434000, false, true, false)
ON CONFLICT (id) DO UPDATE
   SET name = EXCLUDED.name,
       meals_total = EXCLUDED.meals_total,
       days_per_week = EXCLUDED.days_per_week,
       base_price = EXCLUDED.base_price,
       allow_coupons = EXCLUDED.allow_coupons,
       allow_cod = EXCLUDED.allow_cod;
