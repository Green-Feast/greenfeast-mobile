-- 100: Add paid meals needs a reason (2026-11-20).
--
-- Both office adjustments (099) already sit behind the action password and the
-- admin log; Record a delivery already needs a reason. Add paid meals now does
-- too: it's required here (not just in the form), written on the wallet entry
-- of money received, and kept in the admin log for cash still to collect.

DROP FUNCTION IF EXISTS public.admin_add_paid_meals(uuid, integer, boolean, text, integer, integer, text, date, text, uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.admin_add_paid_meals(
  p_sub uuid, p_meals integer, p_collect boolean,
  p_method text, p_cash integer, p_upi integer, p_reference text, p_paid_on date, p_note text,
  p_reason text, p_admin uuid, p_action uuid, p_idem text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s        record;
  v_unit   integer;
  v_amount integer;
  v_res    jsonb := '{}'::jsonb;
  v_left   integer;
BEGIN
  PERFORM money_set_admin(p_admin, p_action);
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Say why these meals are being added.';
  END IF;
  IF p_meals IS NULL OR p_meals < 1 OR p_meals > 90 THEN
    RAISE EXCEPTION 'Add between 1 and 90 meals.';
  END IF;
  SELECT id, user_id, status, plan_name INTO s FROM subscriptions WHERE id = p_sub FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan not found.'; END IF;
  IF s.status NOT IN ('active', 'paused') THEN
    RAISE EXCEPTION 'Paid meals go on a live plan — this one is %.', s.status;
  END IF;

  -- Always meals × the plan's meal price (the unit "meals left" counts in).
  v_unit := default_meal_cost(p_sub);
  IF COALESCE(v_unit, 0) <= 0 THEN RAISE EXCEPTION 'This plan has no meal price.'; END IF;
  v_amount := v_unit * p_meals;

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
      format('Paid meals — %s × %s — %s', p_meals, fmt_rupees(v_unit), trim(p_reason)),
      p_admin, p_action, p_idem);
  END IF;

  SELECT deliveries_remaining INTO v_left FROM subscriptions WHERE id = p_sub;
  RETURN v_res || jsonb_build_object('amount', v_amount, 'unit', v_unit, 'meals', p_meals,
                                     'collect', p_collect, 'meals_left', v_left, 'user_id', s.user_id);
END; $$;
REVOKE ALL ON FUNCTION public.admin_add_paid_meals(uuid, integer, boolean, text, integer, integer, text, date, text, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_add_paid_meals(uuid, integer, boolean, text, integer, integer, text, date, text, text, uuid, uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
