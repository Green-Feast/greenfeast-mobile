-- ============================================================
-- GreenFeast — Migration 081: referrals and gifted meals
-- ============================================================
-- Both are "a meal's worth" of wallet money — the wallet is the plan (079), so
-- one meal's worth gives exactly one more meal: default_meal_cost() of the
-- customer's live plan (their meal price + default add-ons), or the 30-meal
-- plan's meal price when they have no live plan.
--
-- Gifts (admin → Referrals, refunds & gifts → Gift meals): gift_meals() records
-- the gift, credits the wallet (reference gift_<id>) and tells the customer
-- (template meal_gift).
--
-- Referrals: a customer's referral code is their customer code (GF-000123).
-- A friend enters it at checkout (cashfree-create-order → payments.referral_code,
-- checked by referral_check). When that payment's plan starts, the webhook
-- calls apply_payment_referral(): if it is the friend's first paid plan and
-- has 15 meals or more, both get a meal's worth (references
-- referral_<id>_in / _out, so a replayed webhook pays nothing twice) and a
-- message (referral_joined to the friend, referral_reward to the referrer).
-- One referral per friend, ever.

-- ── Gifts ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.meal_gifts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  meals           integer NOT NULL CHECK (meals BETWEEN 1 AND 30),
  meal_cost_paise integer NOT NULL CHECK (meal_cost_paise > 0),
  amount_paise    integer NOT NULL CHECK (amount_paise > 0),
  reason          text NOT NULL,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meal_gifts_user ON public.meal_gifts (user_id);
ALTER TABLE public.meal_gifts ENABLE ROW LEVEL SECURITY;  -- no policies: service role only
REVOKE ALL ON public.meal_gifts FROM anon, authenticated;
GRANT ALL ON public.meal_gifts TO service_role;

-- One meal's worth for this customer.
CREATE OR REPLACE FUNCTION public.meal_worth(p_user uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT public.default_meal_cost(s.id) FROM public.subscriptions s
      WHERE s.user_id = p_user AND s.status IN ('active', 'paused')
      ORDER BY s.created_at DESC LIMIT 1),
    public.plan_meal_rate('plan30'))
$$;
REVOKE ALL ON FUNCTION public.meal_worth(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meal_worth(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.gift_meals(p_user uuid, p_meals integer, p_reason text, p_admin text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cost   integer;
  v_id     uuid;
  v_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
BEGIN
  IF p_meals IS NULL OR p_meals NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'Gift between 1 and 30 meals.';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Add a reason for the gift.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user) THEN
    RAISE EXCEPTION 'Customer not found.';
  END IF;

  v_cost := meal_worth(p_user);
  INSERT INTO meal_gifts (user_id, meals, meal_cost_paise, amount_paise, reason, created_by)
  VALUES (p_user, p_meals, v_cost, v_cost * p_meals, v_reason, p_admin)
  RETURNING id INTO v_id;

  PERFORM wallet_credit(p_user, v_cost * p_meals,
    format('Gift from GreenFeast — %s meal%s', p_meals, CASE WHEN p_meals = 1 THEN '' ELSE 's' END),
    'gift_' || v_id::text);

  PERFORM notify_event(p_user, 'meal_gift', jsonb_build_object(
    'meals', format('%s meal%s', p_meals, CASE WHEN p_meals = 1 THEN '' ELSE 's' END),
    'amount', fmt_rupees(v_cost * p_meals),
    'reason', v_reason));

  RETURN jsonb_build_object('id', v_id, 'meals', p_meals, 'amount', v_cost * p_meals, 'meal_cost', v_cost);
END; $$;
REVOKE ALL ON FUNCTION public.gift_meals(uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gift_meals(uuid, integer, text, text) TO service_role;

-- ── Referrals ───────────────────────────────────────────────────────────────
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS referral_code text;

CREATE TABLE IF NOT EXISTS public.referrals (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id           uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  referee_id            uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  code                  text NOT NULL,
  payment_id            uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  subscription_id       uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  status                text NOT NULL CHECK (status IN ('rewarded', 'rejected')),
  reject_reason         text,
  referrer_credit_paise integer NOT NULL DEFAULT 0,
  referee_credit_paise  integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals (referrer_id);
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;  -- no policies: service role only
REVOKE ALL ON public.referrals FROM anon, authenticated;
GRANT ALL ON public.referrals TO service_role;

-- "gf 123", "GF000123", "gf-000123" → "GF-000123" (test accounts: GT-…).
CREATE OR REPLACE FUNCTION public.normalize_customer_code(p_code text)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN m IS NULL THEN NULL
    ELSE m[1] || '-' || lpad(ltrim(m[2], '0'), 6, '0')
  END
  FROM (SELECT regexp_match(upper(regexp_replace(COALESCE(p_code, ''), '[\s-]', '', 'g')), '^(G[FT])(\d{1,6})$') AS m) x
$$;

-- The single place that decides whether a referral code works for this
-- customer on this plan. p_exclude_sub: the plan being bought (ignored when
-- asking "have they had a plan before?").
CREATE OR REPLACE FUNCTION public.referral_check(p_user uuid, p_code text, p_plan text, p_exclude_sub uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code     text := normalize_customer_code(p_code);
  v_referrer record;
  v_me       record;
  v_meals    integer;
BEGIN
  IF v_code IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'That doesn''t look like a GreenFeast code — it''s like GF-000123.');
  END IF;
  SELECT id, name, is_test INTO v_referrer FROM users WHERE customer_code = v_code;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'We couldn''t find that code. Check it with your friend.');
  END IF;
  IF v_referrer.id = p_user THEN
    RETURN jsonb_build_object('ok', false, 'error', 'That''s your own code — share it with friends instead.');
  END IF;
  SELECT id, is_test INTO v_me FROM users WHERE id = p_user;
  IF v_me.is_test IS DISTINCT FROM v_referrer.is_test THEN
    RETURN jsonb_build_object('ok', false, 'error', 'We couldn''t find that code. Check it with your friend.');
  END IF;
  IF NOT customer_had_plan(v_referrer.id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'That code belongs to someone who isn''t a GreenFeast subscriber yet.');
  END IF;
  IF customer_had_plan(p_user, p_exclude_sub) OR EXISTS (SELECT 1 FROM referrals WHERE referee_id = p_user) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Referral codes are for your first plan with us.');
  END IF;
  SELECT meals_total INTO v_meals FROM plans WHERE id = p_plan;
  IF COALESCE(v_meals, 0) < 15 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Referral codes work on the 15-, 30- and 60-meal plans.');
  END IF;
  RETURN jsonb_build_object('ok', true, 'code', v_code, 'referrer_id', v_referrer.id,
    'referrer_name', split_part(COALESCE(NULLIF(trim(v_referrer.name), ''), 'your friend'), ' ', 1));
END; $$;
REVOKE ALL ON FUNCTION public.referral_check(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_check(uuid, text, text, uuid) TO service_role;

-- For the app's payment screen: the signed-in customer only, no ids out.
CREATE OR REPLACE FUNCTION public.preview_referral(p_code text, p_plan text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN (r->>'ok')::boolean
    THEN jsonb_build_object('ok', true, 'code', r->>'code', 'referrer_name', r->>'referrer_name')
    ELSE r END
  FROM (SELECT public.referral_check(auth.uid(), p_code, p_plan,
          (SELECT s.id FROM public.subscriptions s WHERE s.user_id = auth.uid() AND s.status = 'pending'
            ORDER BY s.created_at DESC LIMIT 1)) AS r) x
$$;
REVOKE ALL ON FUNCTION public.preview_referral(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_referral(text, text) TO authenticated;

-- Called by cashfree-webhook once a paid plan is active.
CREATE OR REPLACE FUNCTION public.apply_payment_referral(p_payment uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pay        record;
  v_plan     text;
  v_check    jsonb;
  v_referrer uuid;
  v_id       uuid;
  v_in       integer;
  v_out      integer;
  v_friend   text;
  v_referrer_name text;
BEGIN
  SELECT id, user_id, subscription_id, referral_code, status INTO pay FROM payments WHERE id = p_payment;
  IF NOT FOUND OR pay.referral_code IS NULL OR pay.subscription_id IS NULL OR pay.status <> 'paid' THEN
    RETURN jsonb_build_object('result', 'none');
  END IF;
  IF EXISTS (SELECT 1 FROM referrals WHERE referee_id = pay.user_id) THEN
    RETURN jsonb_build_object('result', 'already_done');
  END IF;

  SELECT plan_id INTO v_plan FROM subscriptions WHERE id = pay.subscription_id;
  v_check := referral_check(pay.user_id, pay.referral_code, v_plan, pay.subscription_id);

  IF NOT (v_check->>'ok')::boolean THEN
    -- Recorded so the office can see it; the referrer is whoever the code names.
    INSERT INTO referrals (referrer_id, referee_id, code, payment_id, subscription_id, status, reject_reason)
    SELECT u.id, pay.user_id, pay.referral_code, pay.id, pay.subscription_id, 'rejected', v_check->>'error'
      FROM users u WHERE u.customer_code = normalize_customer_code(pay.referral_code) AND u.id <> pay.user_id
    ON CONFLICT (referee_id) DO NOTHING;
    RETURN jsonb_build_object('result', 'rejected', 'error', v_check->>'error');
  END IF;

  v_referrer := (v_check->>'referrer_id')::uuid;
  v_in  := meal_worth(pay.user_id);
  v_out := meal_worth(v_referrer);

  INSERT INTO referrals (referrer_id, referee_id, code, payment_id, subscription_id, status,
                         referrer_credit_paise, referee_credit_paise)
  VALUES (v_referrer, pay.user_id, v_check->>'code', pay.id, pay.subscription_id, 'rewarded', v_out, v_in)
  ON CONFLICT (referee_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('result', 'already_done');
  END IF;

  SELECT split_part(COALESCE(NULLIF(trim(name), ''), 'Your friend'), ' ', 1) INTO v_friend FROM users WHERE id = pay.user_id;
  v_referrer_name := v_check->>'referrer_name';

  PERFORM wallet_credit(pay.user_id, v_in,
    format('Referral reward — a free meal for joining with %s''s code', v_referrer_name), 'referral_' || v_id::text || '_in');
  PERFORM wallet_credit(v_referrer, v_out,
    format('Referral reward — %s joined with your code', v_friend), 'referral_' || v_id::text || '_out');

  PERFORM notify_event(pay.user_id, 'referral_joined',
    jsonb_build_object('friend', v_referrer_name, 'amount', fmt_rupees(v_in)));
  PERFORM notify_event(v_referrer, 'referral_reward',
    jsonb_build_object('friend', v_friend, 'amount', fmt_rupees(v_out)));

  RETURN jsonb_build_object('result', 'rewarded', 'referral_id', v_id, 'referee_credit', v_in, 'referrer_credit', v_out);
END; $$;
REVOKE ALL ON FUNCTION public.apply_payment_referral(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_payment_referral(uuid) TO service_role;

-- For the app's Account → Invite friends.
CREATE OR REPLACE FUNCTION public.my_referrals()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'code', (SELECT customer_code FROM public.users WHERE id = auth.uid()),
    'can_refer', public.customer_had_plan(auth.uid()),
    'joined', (SELECT count(*) FROM public.referrals WHERE referrer_id = auth.uid() AND status = 'rewarded'),
    'earned_paise', (SELECT COALESCE(sum(referrer_credit_paise), 0) FROM public.referrals
                      WHERE referrer_id = auth.uid() AND status = 'rewarded'),
    'friends', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'name', split_part(COALESCE(NULLIF(trim(u.name), ''), 'A friend'), ' ', 1),
                  'date', to_char(r.created_at AT TIME ZONE 'Asia/Kolkata', 'FMDD Mon'))
                  ORDER BY r.created_at DESC)
                FROM public.referrals r JOIN public.users u ON u.id = r.referee_id
               WHERE r.referrer_id = auth.uid() AND r.status = 'rewarded'), '[]'::jsonb))
$$;
REVOKE ALL ON FUNCTION public.my_referrals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_referrals() TO authenticated;

-- ── Messages ────────────────────────────────────────────────────────────────
INSERT INTO public.notification_templates
  (key, sort_order, label, description, placeholders, title, body, default_title, default_body, enabled)
VALUES
  ('meal_gift', 175, 'Meals gifted',
   'Admin → Referrals, refunds & gifts → Gift meals. {meals} is e.g. "2 meals".',
   '{name,meals,amount,reason}',
   'A gift from GreenFeast',
   'We''ve added {meals} ({amount}) to your wallet — {reason}. Enjoy!',
   'A gift from GreenFeast',
   'We''ve added {meals} ({amount}) to your wallet — {reason}. Enjoy!',
   true),
  ('referral_joined', 176, 'Referral — friend''s free meal',
   'A new customer''s first plan (15 meals or more) starts with someone''s referral code. {friend} is the referrer''s first name.',
   '{name,friend,amount}',
   'Your free meal is in your wallet',
   'Thanks for joining with {friend}''s code! A free meal ({amount}) is in your wallet.',
   'Your free meal is in your wallet',
   'Thanks for joining with {friend}''s code! A free meal ({amount}) is in your wallet.',
   true),
  ('referral_reward', 177, 'Referral — referrer''s free meal',
   'Someone''s friend starts their first plan with their code. {friend} is the new customer''s first name.',
   '{name,friend,amount}',
   '{friend} joined — here''s a free meal',
   '{friend} just started a plan with your code, so a free meal ({amount}) is in your wallet. Thank you!',
   '{friend} joined — here''s a free meal',
   '{friend} just started a plan with your code, so a free meal ({amount}) is in your wallet. Thank you!',
   true)
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
