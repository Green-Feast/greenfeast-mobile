-- ============================================================
-- GreenFeast — Migration 083: Sunday stays with the office
-- ============================================================
-- Sunday is GreenFeast's day off, so the app only offers Monday–Saturday. A
-- few customers deliver on Sundays by arrangement (the office adds 'Sun' to
-- their delivery days, e.g. Aman Dua). set_my_plan_defaults (080) deleted
-- every day the app didn't send, so saving Plan & settings silently dropped
-- their Sunday. Now a customer can't add or remove Sunday; it stays as the
-- office set it.

CREATE OR REPLACE FUNCTION public.set_my_plan_defaults(
  p_sub uuid, p_meals_lunch integer, p_meals_dinner integer, p_days text[], p_addons jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sub     uuid := my_live_plan(p_sub);
  v_days    text[];
  v_ids     text[];
  v_bad     text;
  v_starter text;
  v_sync    jsonb;
BEGIN
  IF p_meals_lunch IS NULL OR p_meals_dinner IS NULL
     OR p_meals_lunch NOT BETWEEN 0 AND 3 OR p_meals_dinner NOT BETWEEN 0 AND 3
     OR p_meals_lunch + p_meals_dinner < 1 THEN
    RAISE EXCEPTION 'Choose between 1 and 3 meals for lunch and/or dinner.';
  END IF;

  SELECT array_agg(DISTINCT d) INTO v_days FROM unnest(COALESCE(p_days, '{}')) d;
  IF v_days IS NULL OR array_length(v_days, 1) IS NULL THEN
    RAISE EXCEPTION 'Pick at least one delivery day.';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_days) d WHERE d NOT IN ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat')) THEN
    RAISE EXCEPTION 'Delivery days are Monday to Saturday.';
  END IF;

  SELECT array_agg(DISTINCT x->>'id') INTO v_ids FROM jsonb_array_elements(COALESCE(p_addons, '[]'::jsonb)) x;
  v_ids := COALESCE(v_ids, '{}');
  SELECT i INTO v_bad FROM unnest(v_ids) i
   WHERE NOT EXISTS (SELECT 1 FROM addons a WHERE a.id = i AND a.is_active) LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'One of those add-ons isn''t available.';
  END IF;

  UPDATE subscriptions
     SET meals_lunch = p_meals_lunch, meals_dinner = p_meals_dinner,
         meals_per_day = p_meals_lunch + p_meals_dinner, updated_at = now()
   WHERE id = v_sub;

  -- Delivery days. Each row also names a dish — only a fallback when the
  -- weekly menu has nothing that day — so new days reuse the plan's own.
  SELECT meal_template_id INTO v_starter FROM subscription_schedule WHERE subscription_id = v_sub LIMIT 1;
  IF v_starter IS NULL THEN
    SELECT id INTO v_starter FROM meal_templates WHERE is_active AND subscription_valid ORDER BY category, id LIMIT 1;
  END IF;
  -- Sunday is set by the office only (083): never removed here.
  DELETE FROM subscription_schedule WHERE subscription_id = v_sub AND NOT (day_of_week = ANY (v_days)) AND day_of_week <> 'Sun';
  INSERT INTO subscription_schedule (subscription_id, day_of_week, meal_template_id)
  SELECT v_sub, d, v_starter FROM unnest(v_days) d
   WHERE NOT EXISTS (SELECT 1 FROM subscription_schedule x WHERE x.subscription_id = v_sub AND x.day_of_week = d);

  -- Default add-ons.
  DELETE FROM subscription_addons WHERE subscription_id = v_sub AND NOT (addon_id = ANY (v_ids));
  UPDATE subscription_addons sa
     SET sub_option = NULLIF(x->>'sub_option', '')
    FROM jsonb_array_elements(COALESCE(p_addons, '[]'::jsonb)) x
   WHERE sa.subscription_id = v_sub AND sa.addon_id = x->>'id';
  INSERT INTO subscription_addons (subscription_id, addon_id, sub_option)
  SELECT DISTINCT ON (x->>'id') v_sub, x->>'id', NULLIF(x->>'sub_option', '')
    FROM jsonb_array_elements(COALESCE(p_addons, '[]'::jsonb)) x
   WHERE NOT EXISTS (SELECT 1 FROM subscription_addons sa WHERE sa.subscription_id = v_sub AND sa.addon_id = x->>'id');

  v_sync := resync_plan_orders(v_sub);

  RETURN v_sync || jsonb_build_object(
    'meal_cost', default_meal_cost(v_sub),
    'meals_left', (SELECT deliveries_remaining FROM subscriptions WHERE id = v_sub));
END; $$;
REVOKE ALL ON FUNCTION public.set_my_plan_defaults(uuid, integer, integer, text[], jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_plan_defaults(uuid, integer, integer, text[], jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
