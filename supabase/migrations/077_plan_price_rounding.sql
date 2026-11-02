-- ============================================================
-- GreenFeast — Migration 077: a plan's price always covers its meals
-- ============================================================
-- A meal costs round(plan price ÷ meals), which can come to slightly more than
-- the plan: 30 × ₹249.97 = ₹7,499.10 on the ₹7,499 plan. The wallet then runs out
-- 10 paise short and the cutoff check skips the last meal for insufficient
-- balance. When a plan starts, the wallet now gets that difference (once per
-- plan: wallet_credit ignores a second credit with the same reference). A coupon
-- price is always price × meals, so it has none. Plans already running that are
-- short by it get it now.

CREATE OR REPLACE FUNCTION public.plan_rounding_credit(p_sub uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid;
  v_gap  integer;
BEGIN
  SELECT s.user_id, plan_meal_rate(s.plan_id) * p.meals_total - p.base_price
    INTO v_user, v_gap
    FROM subscriptions s JOIN plans p ON p.id = s.plan_id
   WHERE s.id = p_sub AND s.meal_price_paise IS NULL;
  IF COALESCE(v_gap, 0) <= 0 THEN RETURN 0; END IF;

  PERFORM wallet_credit(v_user, v_gap, 'Rounding on your plan price', 'rounding_' || p_sub::text);
  RETURN v_gap;
END; $$;
REVOKE ALL ON FUNCTION public.plan_rounding_credit(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.subscriptions_rounding_credit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM plan_rounding_credit(NEW.id);
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.subscriptions_rounding_credit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS subscriptions_rounding_credit ON public.subscriptions;
CREATE TRIGGER subscriptions_rounding_credit
  AFTER UPDATE OF status ON public.subscriptions
  FOR EACH ROW WHEN (OLD.status = 'pending' AND NEW.status = 'active')
  EXECUTE FUNCTION public.subscriptions_rounding_credit();

SELECT public.plan_rounding_credit(x.id)
  FROM (
    SELECT s.id,
           COALESCE(w.balance, 0) - s.deliveries_remaining * (
             plan_meal_rate(s.plan_id)
             + COALESCE((SELECT SUM(a.price_per_meal) FROM subscription_addons sa JOIN addons a ON a.id = sa.addon_id WHERE sa.subscription_id = s.id), 0)
           ) AS gap,
           plan_meal_rate(s.plan_id) * p.meals_total - p.base_price AS rounding
      FROM subscriptions s
      JOIN plans p ON p.id = s.plan_id
      LEFT JOIN wallets w ON w.user_id = s.user_id
     WHERE s.status IN ('active', 'paused') AND s.meal_price_paise IS NULL AND s.deliveries_remaining > 0
  ) x
 WHERE x.rounding > 0 AND x.gap < 0 AND x.gap >= -x.rounding;
