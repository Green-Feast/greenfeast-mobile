-- 109: the 5-meal trial can take a coupon (28 Nov 2026).
-- A coupon only works on a plan it has its own price for (coupon_plans), and
-- that price must be below the plan's regular meal price (coupon_plans_check),
-- so existing coupons are unchanged — only a coupon given a trial price applies.
UPDATE public.plans SET allow_coupons = true WHERE id = 'trial';
