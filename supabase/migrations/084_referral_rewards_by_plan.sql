-- ============================================================
-- GreenFeast — Migration 084: referral rewards by plan size, referrer only
-- ============================================================
-- A friend's first plan earns the person who referred them 1 / 2 / 3 meals'
-- worth for a 15- / 30- / 60-meal plan. The friend no longer gets a meal.

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
  v_meals    integer;
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
  -- 084: only the referrer is rewarded — 1 / 2 / 3 meals for a friend's
  -- 15- / 30- / 60-meal plan.
  SELECT CASE WHEN meals_total >= 60 THEN 3 WHEN meals_total >= 30 THEN 2 ELSE 1 END
    INTO v_meals FROM plans WHERE id = v_plan;
  v_in  := 0;
  v_out := meal_worth(v_referrer) * COALESCE(v_meals, 1);

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

  PERFORM wallet_credit(v_referrer, v_out,
    format('Referral reward — %s free meal%s: %s joined with your code', v_meals, CASE WHEN v_meals = 1 THEN '' ELSE 's' END, v_friend), 'referral_' || v_id::text || '_out');

  PERFORM notify_event(v_referrer, 'referral_reward',
    jsonb_build_object('friend', v_friend, 'amount', fmt_rupees(v_out),
      'meals', format('%s free meal%s', v_meals, CASE WHEN v_meals = 1 THEN '' ELSE 's' END)));

  RETURN jsonb_build_object('result', 'rewarded', 'referral_id', v_id, 'referee_credit', v_in, 'referrer_credit', v_out);
END; $$;
REVOKE ALL ON FUNCTION public.apply_payment_referral(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_payment_referral(uuid) TO service_role;

UPDATE public.notification_templates
   SET title = '{friend} joined — {meals} for you',
       body = '{friend} just started a plan with your code, so {meals} ({amount}) are in your wallet. Thank you!',
       default_title = '{friend} joined — {meals} for you',
       default_body = '{friend} just started a plan with your code, so {meals} ({amount}) are in your wallet. Thank you!',
       placeholders = '{name,friend,meals,amount}'
 WHERE key = 'referral_reward';
UPDATE public.notification_templates SET enabled = false WHERE key = 'referral_joined';

NOTIFY pgrst, 'reload schema';
