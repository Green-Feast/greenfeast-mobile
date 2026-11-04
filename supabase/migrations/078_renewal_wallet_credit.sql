-- ============================================================
-- GreenFeast — Migration 078: extra wallet money comes off the next plan
-- ============================================================
-- The meal counter and the wallet stay separate, and the wallet belongs to the
-- account. Money beyond what the meals still to come need is "extra", and any
-- plan bought (renewal or new) charges that much less: it simply stays in the
-- wallet, so paid + extra = the new plan's price and no money moves.
-- cashfree-create-order applies it; the app's Renew sheet and payment screen
-- show it. Never with cash still owed on a live plan.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS wallet_credit_paise integer NOT NULL DEFAULT 0 CHECK (wallet_credit_paise >= 0);

CREATE OR REPLACE FUNCTION public.renewal_credit(p_user uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_balance integer;
  v_open    integer;
  v_rest    integer;
BEGIN
  IF EXISTS (SELECT 1 FROM subscriptions
              WHERE user_id = p_user AND status IN ('active', 'paused')
                AND (cod_on_credit OR COALESCE(cod_due_paise, 0) > 0)) THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(balance, 0) INTO v_balance FROM wallets WHERE user_id = p_user;

  -- Meals made and still to be billed, extras included. Days before 1 Nov are
  -- left unmarked on purpose (070) and won't be billed.
  SELECT COALESCE(SUM(recompute_order_cart(o.id)), 0)::integer INTO v_open
    FROM orders o
   WHERE o.user_id = p_user
     AND o.delivery_date >= DATE '2026-11-01'
     AND o.status IN ('scheduled', 'confirmed', 'preparing', 'out_for_delivery');

  -- Meals on the plan with no order yet, at the plan's price per meal.
  SELECT COALESCE(SUM(
           GREATEST(s.deliveries_remaining - COALESCE((
             SELECT SUM(COALESCE(o.quantity, 1)) FROM orders o
              WHERE o.subscription_id = s.id
                AND o.delivery_date >= DATE '2026-11-01'
                AND o.status IN ('scheduled', 'confirmed', 'preparing', 'out_for_delivery')), 0), 0)
           * (subscription_meal_rate(s.id) + COALESCE((
             SELECT SUM(a.price_per_meal) FROM subscription_addons sa JOIN addons a ON a.id = sa.addon_id
              WHERE sa.subscription_id = s.id), 0))
         ), 0)::integer INTO v_rest
    FROM subscriptions s
   WHERE s.user_id = p_user AND s.status IN ('active', 'paused');

  RETURN GREATEST(COALESCE(v_balance, 0) - v_open - v_rest, 0);
END; $$;
REVOKE ALL ON FUNCTION public.renewal_credit(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renewal_credit(uuid) TO service_role;

-- For the app's Renew sheet: the signed-in customer's own figure only.
CREATE OR REPLACE FUNCTION public.my_renewal_credit()
RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.renewal_credit(auth.uid())
$$;
REVOKE ALL ON FUNCTION public.my_renewal_credit() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_renewal_credit() TO authenticated;

NOTIFY pgrst, 'reload schema';
