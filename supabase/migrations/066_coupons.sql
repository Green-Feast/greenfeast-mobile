-- ============================================================
-- GreenFeast — Migration 066: coupons
-- ============================================================
-- The admin makes coupon codes (admin → Coupons). A coupon lowers the price
-- of one meal on the 15- and 30-meal plans (never the trial): it has its own
-- per-meal price for each plan, so the whole plan costs that × meals.
--
-- Why the meal price and not just the payment: a plan payment goes into the
-- wallet and every delivered meal debits its order's unit_price. A plan
-- bought with a coupon keeps its meal price on the subscription
-- (subscriptions.meal_price_paise, null = the plan's regular price) and every
-- place that prices a meal reads subscription_meal_rate() — so the wallet
-- covers exactly the plan's meals. Extra dishes and extra portions use up plan
-- meals too, so they get the same price.
--
-- Who: new sign-ups (no plan ever before) / renewers (had one) / selected
-- customers — any mix. When: starts_on … ends_on (India dates, inclusive).
-- Used when buying a plan (new, renewal, or created by the admin) — never for
-- wallet top-ups. cashfree-create-order prices with coupon_quote(); the
-- webhook copies the paid coupon onto the plan (apply_payment_coupon).
-- ============================================================

-- ── Which plans can take a coupon ────────────────────────────────────────────
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS allow_coupons boolean NOT NULL DEFAULT false;
UPDATE public.plans SET allow_coupons = (id IN ('plan15', 'plan30'));

-- ── Coupons ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.coupons (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{2,23}$'),
  name             text,                                   -- internal note, never shown to customers
  starts_on        date NOT NULL,
  ends_on          date NOT NULL,
  for_new          boolean NOT NULL DEFAULT false,         -- first plan
  for_renewal      boolean NOT NULL DEFAULT false,         -- has had a plan before
  for_selected     boolean NOT NULL DEFAULT false,         -- coupon_customers
  max_per_customer integer DEFAULT 1 CHECK (max_per_customer IS NULL OR max_per_customer >= 1),
  max_total        integer CHECK (max_total IS NULL OR max_total >= 1),
  active           boolean NOT NULL DEFAULT true,          -- false = paused
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on),
  CHECK (for_new OR for_renewal OR for_selected)
);
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coupons FROM anon, authenticated;
GRANT ALL ON public.coupons TO service_role;
DROP TRIGGER IF EXISTS coupons_updated_at ON public.coupons;
CREATE TRIGGER coupons_updated_at BEFORE UPDATE ON public.coupons
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- The coupon's price for one meal, per plan.
CREATE TABLE IF NOT EXISTS public.coupon_plans (
  coupon_id        uuid NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  plan_id          text NOT NULL REFERENCES public.plans(id),
  meal_price_paise integer NOT NULL CHECK (meal_price_paise > 0),
  PRIMARY KEY (coupon_id, plan_id)
);
ALTER TABLE public.coupon_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coupon_plans FROM anon, authenticated;
GRANT ALL ON public.coupon_plans TO service_role;

-- "Selected customers".
CREATE TABLE IF NOT EXISTS public.coupon_customers (
  coupon_id uuid NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  PRIMARY KEY (coupon_id, user_id)
);
CREATE INDEX IF NOT EXISTS coupon_customers_user ON public.coupon_customers (user_id);
ALTER TABLE public.coupon_customers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coupon_customers FROM anon, authenticated;
GRANT ALL ON public.coupon_customers TO service_role;

-- Every use: a paid plan, or a plan the admin created with it.
CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id                uuid NOT NULL REFERENCES public.coupons(id) ON DELETE RESTRICT,
  user_id                  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  subscription_id          uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  payment_id               uuid UNIQUE REFERENCES public.payments(id) ON DELETE SET NULL,
  plan_id                  text NOT NULL REFERENCES public.plans(id),
  kind                     text NOT NULL CHECK (kind IN ('new', 'renewal', 'admin')),
  meal_price_paise         integer NOT NULL,
  regular_meal_price_paise integer NOT NULL,
  meals                    integer NOT NULL,
  discount_paise           integer NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coupon_redemptions_coupon ON public.coupon_redemptions (coupon_id, user_id);
ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coupon_redemptions FROM anon, authenticated;
GRANT ALL ON public.coupon_redemptions TO service_role;

-- What a plan / a payment was bought at.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS meal_price_paise integer CHECK (meal_price_paise IS NULL OR meal_price_paise > 0),
  ADD COLUMN IF NOT EXISTS coupon_id uuid REFERENCES public.coupons(id) ON DELETE SET NULL;
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS coupon_id uuid REFERENCES public.coupons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS meal_price_paise integer,
  ADD COLUMN IF NOT EXISTS discount_paise integer;

-- ── The one billing rate ─────────────────────────────────────────────────────
-- A plan's regular price for one meal (same formula the app always used).
CREATE OR REPLACE FUNCTION public.plan_meal_rate(p_plan text)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT round(base_price::numeric / GREATEST(meals_total, 1))::integer FROM public.plans WHERE id = p_plan
$$;

-- What one meal costs on this subscription: its coupon price, else regular.
CREATE OR REPLACE FUNCTION public.subscription_meal_rate(p_sub uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(s.meal_price_paise, public.plan_meal_rate(s.plan_id)) FROM public.subscriptions s WHERE s.id = p_sub
$$;
REVOKE ALL ON FUNCTION public.plan_meal_rate(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.subscription_meal_rate(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan_meal_rate(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.subscription_meal_rate(uuid) TO service_role;

-- A coupon price must be a real discount, and only on plans that allow coupons.
CREATE OR REPLACE FUNCTION public.coupon_plans_check()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_allow boolean;
  v_rate  integer;
BEGIN
  SELECT allow_coupons, public.plan_meal_rate(id) INTO v_allow, v_rate FROM public.plans WHERE id = NEW.plan_id;
  IF NOT COALESCE(v_allow, false) THEN
    RAISE EXCEPTION 'Coupons can''t be used on the % plan.', NEW.plan_id;
  END IF;
  IF NEW.meal_price_paise >= v_rate THEN
    RAISE EXCEPTION 'The coupon price for % must be below the regular % paise per meal.', NEW.plan_id, v_rate;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS coupon_plans_check ON public.coupon_plans;
CREATE TRIGGER coupon_plans_check BEFORE INSERT OR UPDATE ON public.coupon_plans
  FOR EACH ROW EXECUTE FUNCTION public.coupon_plans_check();

-- Has this customer had a plan before (= a renewal, not a new sign-up)?
-- p_exclude: the plan being bought right now.
CREATE OR REPLACE FUNCTION public.customer_had_plan(p_user uuid, p_exclude uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.subscriptions s
                  WHERE s.user_id = p_user AND s.id IS DISTINCT FROM p_exclude
                    AND s.status IN ('active', 'paused', 'expired'))
      OR EXISTS (SELECT 1 FROM public.orders o
                  WHERE o.user_id = p_user AND o.status = 'delivered'
                    AND o.subscription_id IS DISTINCT FROM p_exclude)
$$;
REVOKE ALL ON FUNCTION public.customer_had_plan(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── Checking a coupon ────────────────────────────────────────────────────────
-- The single place that decides whether a code works and what it costs.
-- p_kind 'admin' (admin → Create subscription) skips the "who" check.
-- Returns {ok:true, coupon_id, code, kind, plan_id, meals, meal_price_paise,
-- regular_meal_price_paise, addon_per_meal_paise, total_paise,
-- regular_total_paise, discount_paise} or {ok:false, error}.
CREATE OR REPLACE FUNCTION public.coupon_quote(
  p_user uuid, p_code text, p_plan text, p_addon_per_meal integer DEFAULT 0,
  p_kind text DEFAULT NULL, p_exclude_sub uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today   date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  c         public.coupons%ROWTYPE;
  p         public.plans%ROWTYPE;
  v_price   integer;
  v_rate    integer;
  v_kind    text;
  v_ok      boolean;
  v_used    integer;
  v_addon   integer := GREATEST(COALESCE(p_addon_per_meal, 0), 0);
  v_total   integer;
  v_regular integer;
BEGIN
  SELECT * INTO c FROM public.coupons WHERE code = upper(btrim(COALESCE(p_code, '')));
  IF NOT FOUND OR NOT c.active THEN
    RETURN jsonb_build_object('ok', false, 'error', 'That code isn''t valid.');
  END IF;
  IF v_today < c.starts_on THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This code starts on ' || to_char(c.starts_on, 'FMDD Mon') || '.');
  END IF;
  IF v_today > c.ends_on THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This code has expired.');
  END IF;

  SELECT * INTO p FROM public.plans WHERE id = p_plan;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pick a plan first.');
  END IF;
  IF NOT p.allow_coupons THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Codes can''t be used on the ' || p.name || '.');
  END IF;
  SELECT meal_price_paise INTO v_price FROM public.coupon_plans WHERE coupon_id = c.id AND plan_id = p.id;
  IF v_price IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This code isn''t valid for the ' || p.name || '.');
  END IF;

  IF p_kind = 'admin' THEN
    v_kind := 'admin';
  ELSE
    v_kind := CASE WHEN public.customer_had_plan(p_user, p_exclude_sub) THEN 'renewal' ELSE 'new' END;
    v_ok := (c.for_new AND v_kind = 'new')
         OR (c.for_renewal AND v_kind = 'renewal')
         OR (c.for_selected AND EXISTS (SELECT 1 FROM public.coupon_customers
                                         WHERE coupon_id = c.id AND user_id = p_user));
    IF NOT v_ok THEN
      RETURN jsonb_build_object('ok', false, 'error',
        CASE WHEN c.for_new AND NOT c.for_renewal AND v_kind = 'renewal' AND NOT c.for_selected THEN 'This code is for new customers.'
             WHEN c.for_renewal AND NOT c.for_new AND v_kind = 'new' AND NOT c.for_selected THEN 'This code is for renewals.'
             ELSE 'This code isn''t valid for your account.' END);
    END IF;
  END IF;

  IF c.max_per_customer IS NOT NULL THEN
    SELECT count(*) INTO v_used FROM public.coupon_redemptions WHERE coupon_id = c.id AND user_id = p_user;
    IF v_used >= c.max_per_customer THEN
      RETURN jsonb_build_object('ok', false, 'error',
        CASE WHEN c.max_per_customer = 1 THEN 'You''ve already used this code.' ELSE 'You''ve used this code as many times as it allows.' END);
    END IF;
  END IF;
  IF c.max_total IS NOT NULL THEN
    SELECT count(*) INTO v_used FROM public.coupon_redemptions WHERE coupon_id = c.id;
    IF v_used >= c.max_total THEN
      RETURN jsonb_build_object('ok', false, 'error', 'This code has been fully used.');
    END IF;
  END IF;

  v_rate    := public.plan_meal_rate(p.id);
  v_total   := (v_price + v_addon) * p.meals_total;
  v_regular := p.base_price + v_addon * p.meals_total;
  RETURN jsonb_build_object(
    'ok', true, 'coupon_id', c.id, 'code', c.code, 'kind', v_kind, 'plan_id', p.id, 'meals', p.meals_total,
    'meal_price_paise', v_price, 'regular_meal_price_paise', v_rate, 'addon_per_meal_paise', v_addon,
    'total_paise', v_total, 'regular_total_paise', v_regular, 'discount_paise', GREATEST(v_regular - v_total, 0));
END; $$;
REVOKE ALL ON FUNCTION public.coupon_quote(uuid, text, text, integer, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coupon_quote(uuid, text, text, integer, text, uuid) TO service_role;

-- ── For the signed-in customer (the app's payment screens) ──────────────────
-- Live price with a code, before anything is created.
CREATE OR REPLACE FUNCTION public.preview_coupon(p_code text, p_plan_id text, p_addon_ids text[] DEFAULT '{}')
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_addon integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Please sign in again.');
  END IF;
  SELECT COALESCE(sum(price_per_meal), 0) INTO v_addon
    FROM public.addons WHERE id = ANY (COALESCE(p_addon_ids, '{}'));
  RETURN public.coupon_quote(auth.uid(), p_code, p_plan_id, v_addon);
END; $$;
REVOKE ALL ON FUNCTION public.preview_coupon(text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_coupon(text, text, text[]) TO authenticated;

-- "Selected customers" coupons this customer can use now (shown as offers).
CREATE OR REPLACE FUNCTION public.my_coupon_offers()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'code', c.code,
           'ends_on', c.ends_on,
           'plans', (SELECT jsonb_object_agg(cp.plan_id, cp.meal_price_paise) FROM public.coupon_plans cp WHERE cp.coupon_id = c.id)
         ) ORDER BY c.ends_on), '[]'::jsonb)
    FROM public.coupons c
    JOIN public.coupon_customers cc ON cc.coupon_id = c.id AND cc.user_id = auth.uid()
   WHERE c.active AND c.for_selected
     AND (now() AT TIME ZONE 'Asia/Kolkata')::date BETWEEN c.starts_on AND c.ends_on
     AND (c.max_per_customer IS NULL OR (SELECT count(*) FROM public.coupon_redemptions r
                                          WHERE r.coupon_id = c.id AND r.user_id = auth.uid()) < c.max_per_customer)
     AND (c.max_total IS NULL OR (SELECT count(*) FROM public.coupon_redemptions r WHERE r.coupon_id = c.id) < c.max_total)
$$;
REVOKE ALL ON FUNCTION public.my_coupon_offers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_coupon_offers() TO authenticated;

-- ── After a paid plan payment ────────────────────────────────────────────────
-- Copies the coupon the payment was priced with onto its plan (before the
-- plan is activated and its orders are made) and records the use. Safe to
-- call more than once (webhook retries).
CREATE OR REPLACE FUNCTION public.apply_payment_coupon(p_payment uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pay public.payments%ROWTYPE;
  v_plan text;
  v_meals integer;
BEGIN
  SELECT * INTO pay FROM public.payments WHERE id = p_payment;
  IF NOT FOUND OR pay.coupon_id IS NULL OR pay.subscription_id IS NULL OR pay.meal_price_paise IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.subscriptions
     SET meal_price_paise = pay.meal_price_paise, coupon_id = pay.coupon_id
   WHERE id = pay.subscription_id
  RETURNING plan_id INTO v_plan;
  SELECT meals_total INTO v_meals FROM public.plans WHERE id = v_plan;
  INSERT INTO public.coupon_redemptions
    (coupon_id, user_id, subscription_id, payment_id, plan_id, kind,
     meal_price_paise, regular_meal_price_paise, meals, discount_paise)
  VALUES
    (pay.coupon_id, pay.user_id, pay.subscription_id, pay.id, v_plan,
     CASE WHEN public.customer_had_plan(pay.user_id, pay.subscription_id) THEN 'renewal' ELSE 'new' END,
     pay.meal_price_paise, public.plan_meal_rate(v_plan), COALESCE(v_meals, 0), COALESCE(pay.discount_paise, 0))
  ON CONFLICT (payment_id) DO NOTHING;
END; $$;
REVOKE ALL ON FUNCTION public.apply_payment_coupon(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_payment_coupon(uuid) TO service_role;
