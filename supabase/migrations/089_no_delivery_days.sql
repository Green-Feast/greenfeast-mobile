-- ============================================================
-- GreenFeast — Migration 089: Zero delivery days
-- ============================================================
-- A customer who eats on walk-in (087) or orders day by day wants no regular
-- deliveries at all. Until now Plan & settings refused to save with no days
-- ("Pick at least one delivery day."), and could not have allowed it: an EMPTY
-- subscription_schedule has always meant "deliver every day the kitchen cooks"
-- (instantiate-orders falls back to the weekly menu, resync_plan_orders and
-- remind_pause_ending treat no rows as "no day is off"). Deleting the check
-- would have turned "no days" into "every day".
--
-- So "no deliveries" is its own flag, subscriptions.no_delivery_days, and
-- existing plans (flag false) keep the empty-schedule = every-day rule exactly
-- as it was:
--
--   flag false, no schedule rows  → every day (unchanged)
--   flag false, schedule rows     → only those days (unchanged)
--   flag true,  no schedule rows  → nothing is delivered
--   flag true,  schedule rows     → only those rows (an office-set Sunday, 083)
--
-- Readers of the schedule, all redefined below or in code:
--   * set_my_plan_defaults (087)   — empty days now means "no deliveries"
--   * resync_plan_orders   (088)   — open meals on days that are now off are
--                                    cancelled, which with the flag is every day
--   * remind_pause_ending  (076)   — no "your meals restart" text for a plan
--                                    that has no delivery day to restart on
--   * instantiate-orders function  — selects the flag; deploy it AFTER this
--   * renew-subscription function  — a renewal keeps the flag; deploy AFTER this
--   * admin: plan settings, plan-sync, subscriber profile
-- No SQL estimator reads the schedule (meals_left_estimate, schedulable_paise,
-- default_meal_cost and the cutoff checks work from money and orders only).

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS no_delivery_days boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.subscriptions.no_delivery_days IS
  '089: the customer (or the office) chose no regular delivery days — nothing is scheduled except days listed in subscription_schedule (an office-set Sunday, 083). Only matters when the schedule has no rows: with the flag false an empty schedule still means every day the kitchen cooks. Set by set_my_plan_defaults and the admin''s plan settings; copied to a renewal by renew-subscription.';

-- ── 1. resync_plan_orders (088): no days = every day is off ─────────────────
-- Identical to 088 except that with the flag set the plan's delivery days are
-- exactly its schedule rows (an empty list, not "unknown"), so open, unlocked,
-- unedited meals on every other day are cancelled ('off_day') the way a day
-- taken off is today. Meals the customer changed by hand (cart_edited), extra
-- dishes and walk-ins stay, as before.
CREATE OR REPLACE FUNCTION public.resync_plan_orders(p_sub uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s         record;
  o         record;
  v_today   date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_days    text[];
  v_price   integer;
  v_qty     integer;
  v_dish    text;
  v_fixed   boolean;
  v_updated integer := 0;
  v_moved   integer := 0;
  v_off     integer := 0;
BEGIN
  SELECT id, user_id, meals_lunch, meals_dinner, no_delivery_days INTO s FROM subscriptions WHERE id = p_sub;
  IF NOT FOUND THEN RETURN jsonb_build_object('updated', 0, 'dish_changed', 0, 'cancelled', 0); END IF;

  v_price := subscription_meal_rate(p_sub) + addons_per_meal(p_sub);
  SELECT array_agg(day_of_week) INTO v_days FROM subscription_schedule WHERE subscription_id = p_sub;
  -- NULL (no rows) means every day, unless the plan has no delivery days.
  IF s.no_delivery_days THEN v_days := COALESCE(v_days, '{}'); END IF;

  FOR o IN
    SELECT id, delivery_date, meal_slot, meal_template_id, drink_template_id
      FROM orders
     WHERE subscription_id = p_sub
       AND status IN ('scheduled', 'confirmed')
       AND delivery_date >= v_today
       AND NOT COALESCE(extra_dish, false)
       AND NOT walk_in
       AND NOT cart_edited
     ORDER BY delivery_date, meal_slot
     FOR UPDATE
  LOOP
    CONTINUE WHEN is_slot_locked(o.delivery_date, o.meal_slot);

    v_qty := CASE o.meal_slot WHEN 'lunch' THEN COALESCE(s.meals_lunch, 0) ELSE COALESCE(s.meals_dinner, 0) END;
    IF v_qty <= 0
       OR (v_days IS NOT NULL AND NOT (trim(to_char(o.delivery_date, 'Dy')) = ANY (v_days))) THEN
      UPDATE orders SET status = 'cancelled', skip_reason = 'off_day', updated_at = now() WHERE id = o.id;
      v_off := v_off + 1;
      CONTINUE;
    END IF;

    v_dish  := plan_default_dish(s.user_id, o.delivery_date, o.meal_slot);
    v_fixed := plan_rule_dish(s.user_id, o.delivery_date, o.meal_slot) IS NOT NULL;

    UPDATE orders
       SET quantity = v_qty,
           unit_price = v_price,
           meal_template_id = COALESCE(v_dish, meal_template_id),
           is_customized = v_fixed,
           updated_at = now()
     WHERE id = o.id;
    IF v_dish IS NOT NULL AND v_dish IS DISTINCT FROM o.meal_template_id THEN
      PERFORM snapshot_order_ingredients(o.id);
      v_moved := v_moved + 1;
    END IF;

    DELETE FROM order_addons WHERE order_id = o.id AND kind = 'addon' AND unit_price IS NULL;
    INSERT INTO order_addons (order_id, addon_id, sub_option)
    SELECT o.id, sa.addon_id,
           CASE WHEN ad.is_drink
                THEN COALESCE((SELECT t.name FROM meal_templates t WHERE t.id = o.drink_template_id), sa.sub_option)
                ELSE sa.sub_option END
      FROM subscription_addons sa JOIN addons ad ON ad.id = sa.addon_id
     WHERE sa.subscription_id = p_sub;

    PERFORM recompute_order_cart(o.id);
    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object('updated', v_updated, 'dish_changed', v_moved, 'cancelled', v_off);
END; $$;
REVOKE ALL ON FUNCTION public.resync_plan_orders(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resync_plan_orders(uuid) TO service_role;

-- ── 2. set_my_plan_defaults (087): no days is allowed ───────────────────────
-- Identical to 087 (signature, grants, SECURITY DEFINER, the portions and
-- add-on rules) except for the delivery days:
--   * an explicit empty list (not NULL — that is still refused, as a client bug
--     must never switch deliveries off) = "no deliveries": the flag goes on and
--     the Monday–Saturday schedule rows are deleted; Sunday stays as the office
--     set it (083);
--   * one or more days = the flag goes off and the days are saved as before.
-- Then resync_plan_orders removes the open meals on days that are now off.
CREATE OR REPLACE FUNCTION public.set_my_plan_defaults(
  p_sub uuid, p_meals_lunch integer, p_meals_dinner integer, p_days text[], p_addons jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sub     uuid := my_live_plan(p_sub);
  s         record;
  v_days    text[];
  v_none    boolean;
  v_ids     text[];
  v_have    text[];
  v_starter text;
  v_sync    jsonb;
BEGIN
  SELECT meals_lunch, meals_dinner INTO s FROM subscriptions WHERE id = v_sub FOR UPDATE;

  IF p_meals_lunch IS NULL OR p_meals_dinner IS NULL
     OR (COALESCE(s.meals_lunch, 0) > 0) <> (p_meals_lunch > 0)
     OR (COALESCE(s.meals_dinner, 0) > 0) <> (p_meals_dinner > 0) THEN
    RAISE EXCEPTION 'Lunch and dinner stay as you chose when you joined — message us on WhatsApp to change them.';
  END IF;
  IF p_meals_lunch NOT BETWEEN 0 AND 10 OR p_meals_dinner NOT BETWEEN 0 AND 10 THEN
    RAISE EXCEPTION 'Choose between 1 and 10 portions.';
  END IF;

  IF p_days IS NULL THEN
    RAISE EXCEPTION 'Pick your delivery days.';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT d), '{}') INTO v_days FROM unnest(p_days) d WHERE d IS NOT NULL;
  v_none := array_length(v_days, 1) IS NULL;   -- an empty list: no regular deliveries
  IF EXISTS (SELECT 1 FROM unnest(v_days) d WHERE d NOT IN ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat')) THEN
    RAISE EXCEPTION 'Delivery days are Monday to Saturday.';
  END IF;

  IF p_addons IS NOT NULL THEN
    SELECT COALESCE(array_agg(DISTINCT x->>'id' ORDER BY x->>'id'), '{}') INTO v_ids
      FROM jsonb_array_elements(p_addons) x;
    SELECT COALESCE(array_agg(addon_id ORDER BY addon_id), '{}') INTO v_have
      FROM subscription_addons WHERE subscription_id = v_sub;
    IF v_ids IS DISTINCT FROM v_have THEN
      RAISE EXCEPTION 'Add-ons stay as you chose when you joined — message us on WhatsApp to change them.';
    END IF;
  END IF;

  UPDATE subscriptions
     SET meals_lunch = p_meals_lunch, meals_dinner = p_meals_dinner,
         meals_per_day = p_meals_lunch + p_meals_dinner,
         no_delivery_days = v_none,
         updated_at = now()
   WHERE id = v_sub;

  IF v_none THEN
    -- No regular deliveries. Sunday is set by the office only (083): kept.
    DELETE FROM subscription_schedule WHERE subscription_id = v_sub AND day_of_week <> 'Sun';
  ELSE
    -- Delivery days. Each row also names a dish — only a fallback when the
    -- weekly menu has nothing that day — so new days reuse the plan's own
    -- (never a drink, 088: with days switched off and on again there may be
    -- no row left to copy).
    SELECT meal_template_id INTO v_starter FROM subscription_schedule WHERE subscription_id = v_sub LIMIT 1;
    IF v_starter IS NULL THEN
      SELECT id INTO v_starter FROM meal_templates
       WHERE is_active AND subscription_valid AND COALESCE(category, '') NOT IN ('smoothie', 'coffee')
       ORDER BY category, id LIMIT 1;
    END IF;
    -- Sunday is set by the office only (083): never removed here.
    DELETE FROM subscription_schedule WHERE subscription_id = v_sub AND NOT (day_of_week = ANY (v_days)) AND day_of_week <> 'Sun';
    INSERT INTO subscription_schedule (subscription_id, day_of_week, meal_template_id)
    SELECT v_sub, d, v_starter FROM unnest(v_days) d
     WHERE NOT EXISTS (SELECT 1 FROM subscription_schedule x WHERE x.subscription_id = v_sub AND x.day_of_week = d);
  END IF;

  -- A flavour change from an older app (same add-ons).
  IF p_addons IS NOT NULL THEN
    UPDATE subscription_addons sa
       SET sub_option = NULLIF(left(x->>'sub_option', 60), '')
      FROM jsonb_array_elements(p_addons) x
     WHERE sa.subscription_id = v_sub AND sa.addon_id = x->>'id';
  END IF;

  v_sync := resync_plan_orders(v_sub);

  RETURN v_sync || jsonb_build_object(
    'meal_cost', default_meal_cost(v_sub),
    'meals_left', (SELECT deliveries_remaining FROM subscriptions WHERE id = v_sub),
    'no_delivery_days', v_none);
END; $$;
REVOKE ALL ON FUNCTION public.set_my_plan_defaults(uuid, integer, integer, text[], jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_plan_defaults(uuid, integer, integer, text[], jsonb) TO authenticated;

-- ── 3. remind_pause_ending (076): no restart text without a delivery day ────
-- The reminder tells the customer which day meals restart. With the flag set
-- only schedule rows count as delivery days, so a plan with none finds no
-- restart day and is skipped (there is nothing restarting). Otherwise 076's.
CREATE OR REPLACE FUNCTION public.remind_pause_ending()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  s       record;
  v_day   date;
  v_next  date;
  n       integer := 0;
BEGIN
  FOR s IN
    SELECT id, user_id, meals_lunch, meals_dinner, no_delivery_days
      FROM subscriptions
     WHERE status = 'paused' AND pause_until = v_today AND deliveries_remaining > 0
  LOOP
    -- The first day the order run can use: not Sunday, one of the plan's
    -- delivery days if it has any (or has chosen none), and with a slot of
    -- theirs not closed.
    v_next := NULL;
    FOR v_day IN SELECT generate_series(v_today + 1, v_today + 14, interval '1 day')::date LOOP
      CONTINUE WHEN EXTRACT(DOW FROM v_day) = 0;
      CONTINUE WHEN (s.no_delivery_days OR EXISTS (SELECT 1 FROM subscription_schedule x WHERE x.subscription_id = s.id))
        AND NOT EXISTS (SELECT 1 FROM subscription_schedule x
                         WHERE x.subscription_id = s.id AND x.day_of_week = to_char(v_day, 'Dy'));
      CONTINUE WHEN NOT (
        (COALESCE(s.meals_lunch, 0) > 0 AND NOT EXISTS (SELECT 1 FROM kitchen_closures c WHERE c.closed_on = v_day AND c.meal_slot = 'lunch'))
        OR (COALESCE(s.meals_dinner, 0) > 0 AND NOT EXISTS (SELECT 1 FROM kitchen_closures c WHERE c.closed_on = v_day AND c.meal_slot = 'dinner')));
      v_next := v_day;
      EXIT;
    END LOOP;
    CONTINUE WHEN v_next IS NULL;

    PERFORM notify_event(s.user_id, 'pause_ending', jsonb_build_object(
      'when', CASE v_next WHEN v_today + 1 THEN 'tomorrow' ELSE 'on ' || to_char(v_next, 'Dy FMDD Mon') END
    ), 'order_update');
    n := n + 1;
  END LOOP;
  RETURN n;
END; $$;
REVOKE ALL ON FUNCTION public.remind_pause_ending() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
