-- 104: Gift money and add paid money (2026-11-20).
--
-- "Meals left" is the wallet ÷ the plan's meal price (079), so the office can
-- also add money directly — the meal counter follows by itself.
--
--   Gift money          admin_gift_money(user, amount, reason): a gift in
--                       rupees (meal_gifts row with meals NULL, wallet entry
--                       'gift_<id>', category gift). The customer's message
--                       says "about N meals (₹X)". Up to 30 meals' worth.
--   Add paid money      admin_add_paid_meals(…, p_amount): an amount instead of
--                       meals × meal price — received (payment with proof) or
--                       cash to collect. Reason required, as before.

-- ── Gifts in rupees ─────────────────────────────────────────────────────────
ALTER TABLE public.meal_gifts ALTER COLUMN meals DROP NOT NULL;
ALTER TABLE public.meal_gifts DROP CONSTRAINT IF EXISTS meal_gifts_meals_check;
ALTER TABLE public.meal_gifts ADD CONSTRAINT meal_gifts_meals_check CHECK (meals IS NULL OR meals BETWEEN 1 AND 30);

CREATE OR REPLACE FUNCTION public.gift_money(p_user uuid, p_amount integer, p_reason text, p_admin text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cost   integer := meal_worth(p_user);
  v_id     uuid;
  v_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_about  integer;
BEGIN
  IF v_reason IS NULL THEN RAISE EXCEPTION 'Add a reason for the gift.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user) THEN RAISE EXCEPTION 'Customer not found.'; END IF;
  IF p_amount IS NULL OR p_amount < 100 OR p_amount > 30 * COALESCE(v_cost, 0) THEN
    RAISE EXCEPTION 'Gift between ₹1 and % (30 meals'' worth).', fmt_rupees(30 * COALESCE(v_cost, 0));
  END IF;
  v_about := floor(p_amount::numeric / NULLIF(v_cost, 0));

  INSERT INTO meal_gifts (user_id, meals, meal_cost_paise, amount_paise, reason, created_by)
  VALUES (p_user, NULL, v_cost, p_amount, v_reason, p_admin)
  RETURNING id INTO v_id;

  PERFORM wallet_credit(p_user, p_amount, 'Gift from GreenFeast — ' || fmt_rupees(p_amount), 'gift_' || v_id::text);

  PERFORM notify_event(p_user, 'meal_gift', jsonb_build_object(
    'meals', CASE WHEN v_about >= 1 THEN format('about %s meal%s', v_about, CASE WHEN v_about = 1 THEN '' ELSE 's' END)
                  ELSE 'money' END,
    'amount', fmt_rupees(p_amount),
    'reason', v_reason));

  RETURN jsonb_build_object('id', v_id, 'amount', p_amount, 'meal_cost', v_cost, 'about_meals', v_about);
END; $$;
REVOKE ALL ON FUNCTION public.gift_money(uuid, integer, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_gift_money(
  p_user uuid, p_amount integer, p_reason text, p_admin uuid, p_admin_email text, p_action uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM money_set_admin(p_admin, p_action);
  RETURN gift_money(p_user, p_amount, p_reason, COALESCE(p_admin_email, p_admin::text));
END; $$;
REVOKE ALL ON FUNCTION public.admin_gift_money(uuid, integer, text, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_gift_money(uuid, integer, text, uuid, text, uuid) TO service_role;

-- ── Add paid meals — or an amount ───────────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_add_paid_meals(uuid, integer, boolean, text, integer, integer, text, date, text, text, uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.admin_add_paid_meals(
  p_sub uuid, p_meals integer, p_collect boolean,
  p_method text, p_cash integer, p_upi integer, p_reference text, p_paid_on date, p_note text,
  p_reason text, p_admin uuid, p_action uuid, p_idem text,
  p_amount integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s        record;
  v_unit   integer;
  v_amount integer;
  v_what   text;
  v_res    jsonb := '{}'::jsonb;
  v_left   integer;
BEGIN
  PERFORM money_set_admin(p_admin, p_action);
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Say why this is being added.';
  END IF;
  SELECT id, user_id, status, plan_name INTO s FROM subscriptions WHERE id = p_sub FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan not found.'; END IF;
  IF s.status NOT IN ('active', 'paused') THEN
    RAISE EXCEPTION 'Paid meals go on a live plan — this one is %.', s.status;
  END IF;

  v_unit := default_meal_cost(p_sub);
  IF COALESCE(v_unit, 0) <= 0 THEN RAISE EXCEPTION 'This plan has no meal price.'; END IF;

  IF p_amount IS NOT NULL THEN
    -- An amount: the meal counter follows from the wallet.
    IF p_amount < 100 OR p_amount > 20000000 THEN RAISE EXCEPTION 'Enter ₹1 – ₹2,00,000.'; END IF;
    v_amount := p_amount;
    v_what := format('Paid money — %s', fmt_rupees(v_amount));
  ELSE
    -- Meals: always meals × the plan's meal price.
    IF p_meals IS NULL OR p_meals < 1 OR p_meals > 90 THEN
      RAISE EXCEPTION 'Add between 1 and 90 meals.';
    END IF;
    v_amount := v_unit * p_meals;
    v_what := format('Paid meals — %s × %s', p_meals, fmt_rupees(v_unit));
  END IF;

  IF p_collect THEN
    UPDATE subscriptions
       SET cod_due_paise = COALESCE(cod_due_paise, 0) + v_amount,
           cod_on_credit = true,
           payment_method = 'cod',
           updated_at = now()
     WHERE id = p_sub;
  ELSE
    v_res := admin_record_payment(
      s.user_id, p_sub, v_amount, p_method, p_cash, p_upi, p_reference, p_paid_on,
      'admin_paid_meals', COALESCE(NULLIF(trim(COALESCE(p_note, '')), ''), trim(p_reason)),
      v_what || ' — ' || trim(p_reason),
      p_admin, p_action, p_idem);
  END IF;

  SELECT deliveries_remaining INTO v_left FROM subscriptions WHERE id = p_sub;
  RETURN v_res || jsonb_build_object('amount', v_amount, 'unit', v_unit, 'meals', p_meals,
                                     'collect', p_collect, 'meals_left', v_left, 'user_id', s.user_id);
END; $$;
REVOKE ALL ON FUNCTION public.admin_add_paid_meals(uuid, integer, boolean, text, integer, integer, text, date, text, text, uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_add_paid_meals(uuid, integer, boolean, text, integer, integer, text, date, text, text, uuid, uuid, text, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
