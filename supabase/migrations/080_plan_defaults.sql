-- ============================================================
-- GreenFeast — Migration 080: customers set their own plan defaults
-- ============================================================
-- Plan & settings in the app now lets the customer change, for every meal to
-- come:
--   * their default meal — portions per slot (meals_lunch / meals_dinner, 0 =
--     slot off) and default add-ons (subscription_addons);
--   * their delivery days (subscription_schedule; Sunday stays off);
--   * a dish of their own per slot, for every day or for a weekday
--     (customer_meal_rules, set_by = 'customer').
-- Everything goes through set_my_plan_defaults / set_my_meal_rule (customers
-- can't write orders or order add-ons, 044). Each change re-syncs the plan's
-- upcoming meals that are still open (resync_plan_orders): portions, price,
-- default add-ons and dish follow the new defaults; meals on a day or slot
-- that's now off are cancelled ('off_day'). The app then runs
-- instantiate-orders to fill new days.
--
-- A day the customer (or the office) changed by hand is left alone:
-- orders.cart_edited, set by update-day-cart, switch-meal and the admin's
-- per-day editors. Back-filled here for open meals already changed by hand.
--
-- The office's fixed dishes win: while an admin rule exists for a slot, the
-- customer can't set dishes for that slot.

-- ── Columns ─────────────────────────────────────────────────────────────────
ALTER TABLE public.customer_meal_rules
  ADD COLUMN IF NOT EXISTS set_by text NOT NULL DEFAULT 'admin' CHECK (set_by IN ('admin', 'customer'));

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cart_edited boolean NOT NULL DEFAULT false;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_skip_reason_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_skip_reason_check CHECK (
  skip_reason = ANY (ARRAY['user', 'insufficient_balance', 'pause', 'admin', 'plan_finished',
                           'kitchen_closed', 'not_delivered', 'off_day'])
);

-- ── The dish a meal gets by default ─────────────────────────────────────────
-- A fixed dish for that weekday, then one for every day (only dishes still on
-- the menu for plans), then the weekly menu. Same order as instantiate-orders.
CREATE OR REPLACE FUNCTION public.plan_rule_dish(p_user uuid, p_date date, p_slot text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.meal_template_id
    FROM public.customer_meal_rules r
    JOIN public.meal_templates t ON t.id = r.meal_template_id AND t.is_active AND t.subscription_valid
   WHERE r.user_id = p_user AND r.meal_slot = p_slot
     AND (r.day_of_week = (extract(isodow FROM p_date)::int - 1) OR r.day_of_week IS NULL)
   ORDER BY r.day_of_week NULLS LAST
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.plan_default_dish(p_user uuid, p_date date, p_slot text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    public.plan_rule_dish(p_user, p_date, p_slot),
    (SELECT w.meal_template_id FROM public.weekly_menu w
      WHERE w.menu_type = 'M1' AND w.meal_slot = p_slot
        AND w.day_of_week = (extract(isodow FROM p_date)::int - 1)
      LIMIT 1))
$$;
REVOKE ALL ON FUNCTION public.plan_rule_dish(uuid, date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plan_default_dish(uuid, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan_rule_dish(uuid, date, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.plan_default_dish(uuid, date, text) TO service_role;

-- ── Bring the plan's open meals in line with its defaults ───────────────────
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
  SELECT id, user_id, meals_lunch, meals_dinner INTO s FROM subscriptions WHERE id = p_sub;
  IF NOT FOUND THEN RETURN jsonb_build_object('updated', 0, 'dish_changed', 0, 'cancelled', 0); END IF;

  v_price := subscription_meal_rate(p_sub) + addons_per_meal(p_sub);
  SELECT array_agg(day_of_week) INTO v_days FROM subscription_schedule WHERE subscription_id = p_sub;

  FOR o IN
    SELECT id, delivery_date, meal_slot, meal_template_id
      FROM orders
     WHERE subscription_id = p_sub
       AND status IN ('scheduled', 'confirmed')
       AND delivery_date >= v_today
       AND NOT COALESCE(extra_dish, false)
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
           -- A fixed dish must survive weekly-menu edits (propagateMenuChanges
           -- only touches meals that aren't customised).
           is_customized = v_fixed,
           updated_at = now()
     WHERE id = o.id;
    IF v_dish IS NOT NULL AND v_dish IS DISTINCT FROM o.meal_template_id THEN
      PERFORM snapshot_order_ingredients(o.id);
      v_moved := v_moved + 1;
    END IF;

    -- Default add-ons are the rows copied from the plan: priced inside the
    -- meal's unit_price, so they carry no price of their own.
    DELETE FROM order_addons WHERE order_id = o.id AND kind = 'addon' AND unit_price IS NULL;
    INSERT INTO order_addons (order_id, addon_id, sub_option)
    SELECT o.id, sa.addon_id, sa.sub_option FROM subscription_addons sa WHERE sa.subscription_id = p_sub;

    PERFORM recompute_order_cart(o.id);
    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object('updated', v_updated, 'dish_changed', v_moved, 'cancelled', v_off);
END; $$;
REVOKE ALL ON FUNCTION public.resync_plan_orders(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resync_plan_orders(uuid) TO service_role;

-- ── The customer's live plan, or an error ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.my_live_plan(p_sub uuid)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM subscriptions
   WHERE id = p_sub AND user_id = auth.uid() AND status IN ('active', 'paused');
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Plan not found.' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.my_live_plan(uuid) FROM PUBLIC, anon, authenticated;

-- ── Default meal, delivery days, lunch / dinner ─────────────────────────────
-- p_addons: [{"id": "seeds"}, {"id": "smoothie", "sub_option": "Creamy Avocado"}]
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
  DELETE FROM subscription_schedule WHERE subscription_id = v_sub AND NOT (day_of_week = ANY (v_days));
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

-- ── Fixed dishes, as the customer sees them ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.my_meal_rules()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', r.id, 'slot', r.meal_slot, 'day', r.day_of_week,
           'meal_id', r.meal_template_id, 'meal_name', t.name, 'set_by', r.set_by,
           'available', t.is_active AND t.subscription_valid)
           ORDER BY r.meal_slot, r.day_of_week NULLS FIRST), '[]'::jsonb)
    FROM public.customer_meal_rules r
    JOIN public.meal_templates t ON t.id = r.meal_template_id
   WHERE r.user_id = auth.uid()
$$;
REVOKE ALL ON FUNCTION public.my_meal_rules() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_meal_rules() TO authenticated;

-- p_day: 0 = Mon … 5 = Sat, NULL = every day. p_meal NULL = back to the
-- weekly menu.
CREATE OR REPLACE FUNCTION public.set_my_meal_rule(p_slot text, p_day integer, p_meal text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_sub  uuid;
  v_sync jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
  IF p_slot NOT IN ('lunch', 'dinner') THEN RAISE EXCEPTION 'Pick lunch or dinner.'; END IF;
  IF p_day IS NOT NULL AND p_day NOT BETWEEN 0 AND 5 THEN RAISE EXCEPTION 'Pick a day from Monday to Saturday.'; END IF;

  SELECT id INTO v_sub FROM subscriptions WHERE user_id = v_user AND status IN ('active', 'paused') LIMIT 1;
  IF v_sub IS NULL THEN RAISE EXCEPTION 'You need a live plan to choose your dishes.'; END IF;

  IF EXISTS (SELECT 1 FROM customer_meal_rules
              WHERE user_id = v_user AND meal_slot = p_slot AND set_by = 'admin') THEN
    RAISE EXCEPTION 'Your % dish is set by GreenFeast — message us on WhatsApp to change it.', p_slot;
  END IF;

  IF p_meal IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM meal_templates WHERE id = p_meal AND is_active AND subscription_valid) THEN
    RAISE EXCEPTION 'That dish isn''t available for plans.';
  END IF;

  DELETE FROM customer_meal_rules
   WHERE user_id = v_user AND meal_slot = p_slot AND day_of_week IS NOT DISTINCT FROM p_day::smallint;
  IF p_meal IS NOT NULL THEN
    INSERT INTO customer_meal_rules (user_id, meal_slot, day_of_week, meal_template_id, created_by, set_by)
    VALUES (v_user, p_slot, p_day::smallint, p_meal, 'customer', 'customer');
  END IF;

  v_sync := resync_plan_orders(v_sub);
  RETURN jsonb_build_object('rules', my_meal_rules()) || v_sync;
END; $$;
REVOKE ALL ON FUNCTION public.set_my_meal_rule(text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_meal_rule(text, integer, text) TO authenticated;

-- ── Back-fill: open meals already changed by hand ───────────────────────────
-- A different dish than its rule / the weekly menu would give, extra add-ons,
-- or a portion count that isn't the plan's default for that slot.
UPDATE public.orders o
   SET cart_edited = true
  FROM public.subscriptions s
 WHERE s.id = o.subscription_id
   AND o.status IN ('scheduled', 'confirmed')
   AND o.delivery_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
   AND NOT COALESCE(o.extra_dish, false)
   AND (
     (o.is_customized AND o.meal_template_id IS DISTINCT FROM public.plan_rule_dish(o.user_id, o.delivery_date, o.meal_slot))
     OR EXISTS (SELECT 1 FROM public.order_addons a
                 WHERE a.order_id = o.id AND (a.unit_price IS NOT NULL OR COALESCE(a.quantity, 1) > 1))
     OR COALESCE(o.quantity, 1) <> CASE o.meal_slot WHEN 'lunch' THEN COALESCE(s.meals_lunch, 1)
                                                    ELSE COALESCE(s.meals_dinner, 1) END
   );

NOTIFY pgrst, 'reload schema';
