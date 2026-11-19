-- ============================================================
-- GreenFeast — Migration 097: the cart is items (meals and drinks)
-- ============================================================
-- A lunch / dinner cart is now a list of items:
--   meal  — an orders row (item_kind 'meal'): dish × quantity, with its own
--           add-on lines (order_addons), every line priced;
--   drink — an orders row (item_kind 'drink'): a smoothie / coffee dish ×
--           quantity. Drinks are menu items, not add-ons, and have no add-ons.
-- A plan's default per slot is M meals (meals_lunch / meals_dinner) and D
-- drinks (drinks_lunch / drinks_dinner; 0 = one per meal when the plan has the
-- drink add-on, else none — see plan_slot_drinks), with the plan's add-ons on
-- the M meals. The Sunday run fills it from the weekly menu
-- (make_default_cart).
--
-- Prices: meal = plan meal price + the dish's premium_paise; drink =
-- drink_price() (the drink add-on's price, ₹200); add-on = its price. Default
-- and extra items cost the same, so a cart's bill is the sum of its items.
-- unit_price no longer includes add-ons — every add-on is its own priced line
-- (plan add-ons flagged is_plan).
--
-- The minimum (customers and office alike): on a slot the plan delivers,
-- meals ≥ M, drinks ≥ D and each plan add-on on ≥ M meals — otherwise the only
-- way down is to skip the slot. Off days / slots: anything. Checked by
-- save_day_cart (the new Customize screen) and slot_cart_problem (the older
-- per-item functions, so old apps can't break it either).
--
-- Switch-over below: open meals keep exactly what they cost; plan add-ons
-- become priced lines; a drink add-on line becomes a drink item.

-- ── Columns ─────────────────────────────────────────────────────────────────
ALTER TABLE public.meal_templates
  ADD COLUMN IF NOT EXISTS premium_paise integer NOT NULL DEFAULT 0 CHECK (premium_paise BETWEEN 0 AND 100000);
COMMENT ON COLUMN public.meal_templates.premium_paise IS
  '097: extra a premium dish costs on top of the plan meal price — charged on a swap into it and on an extra one.';

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS item_kind text NOT NULL DEFAULT 'meal' CHECK (item_kind IN ('meal', 'drink'));
ALTER TABLE public.order_addons
  ADD COLUMN IF NOT EXISTS is_plan boolean NOT NULL DEFAULT false;
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS drinks_lunch smallint NOT NULL DEFAULT 0 CHECK (drinks_lunch BETWEEN 0 AND 3),
  ADD COLUMN IF NOT EXISTS drinks_dinner smallint NOT NULL DEFAULT 0 CHECK (drinks_dinner BETWEEN 0 AND 3);
COMMENT ON COLUMN public.subscriptions.drinks_lunch IS
  '097: drinks in the default lunch. 0 = one per meal when the plan has the drink add-on, else none (plan_slot_drinks).';

-- ── Prices and the default ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.drink_price()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT min(price_per_meal) FROM addons WHERE is_drink AND is_active),
                  (SELECT min(price_per_meal) FROM addons WHERE is_drink), 20000)
$$;

CREATE OR REPLACE FUNCTION public.is_drink_dish(p_t text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM meal_templates WHERE id = p_t AND category IN ('smoothie', 'coffee'))
$$;

-- What one unit of a dish costs on this plan.
CREATE OR REPLACE FUNCTION public.item_unit_price(p_sub uuid, p_t text)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN is_drink_dish(p_t) THEN drink_price()
              ELSE subscription_meal_rate(p_sub) + COALESCE((SELECT premium_paise FROM meal_templates WHERE id = p_t), 0)
         END
$$;

CREATE OR REPLACE FUNCTION public.plan_slot_meals(p_sub uuid, p_slot text)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(CASE p_slot WHEN 'lunch' THEN meals_lunch ELSE meals_dinner END, 0)::integer
    FROM subscriptions WHERE id = p_sub
$$;

CREATE OR REPLACE FUNCTION public.plan_has_drink(p_sub uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM subscription_addons sa JOIN addons a ON a.id = sa.addon_id
                  WHERE sa.subscription_id = p_sub AND a.is_drink)
$$;

CREATE OR REPLACE FUNCTION public.plan_slot_drinks(p_sub uuid, p_slot text)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN COALESCE(CASE p_slot WHEN 'lunch' THEN s.drinks_lunch ELSE s.drinks_dinner END, 0) > 0
      THEN (CASE p_slot WHEN 'lunch' THEN s.drinks_lunch ELSE s.drinks_dinner END)::integer
    WHEN plan_has_drink(s.id) THEN plan_slot_meals(s.id, p_slot)
    ELSE 0 END
    FROM subscriptions s WHERE s.id = p_sub
$$;

-- The plan's add-ons that go on meals (the drink add-on is drinks now).
CREATE OR REPLACE FUNCTION public.plan_meal_addons_price(p_sub uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(a.price_per_meal), 0)::integer
    FROM subscription_addons sa JOIN addons a ON a.id = sa.addon_id
   WHERE sa.subscription_id = p_sub AND NOT a.is_drink
$$;

-- One meal's worth (meals left, gifts, referrals): a default meal with its
-- add-ons plus its share of the default drinks.
CREATE OR REPLACE FUNCTION public.meal_cost_for(p_sub uuid, p_rate integer)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_rate + plan_meal_addons_price(s.id)
         + (drink_price() * (plan_slot_drinks(s.id, 'lunch') + plan_slot_drinks(s.id, 'dinner')))
           / GREATEST(COALESCE(s.meals_lunch, 0) + COALESCE(s.meals_dinner, 0), 1)
    FROM subscriptions s WHERE s.id = p_sub
$$;

CREATE OR REPLACE FUNCTION public.default_meal_cost(p_sub uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT meal_cost_for(p_sub, subscription_meal_rate(p_sub))
$$;

CREATE OR REPLACE FUNCTION public.subscriptions_meals_left()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rate   integer := COALESCE(NEW.meal_price_paise, plan_meal_rate(NEW.plan_id));
  v_drinks integer;
  v_meals  integer := COALESCE(NEW.meals_lunch, 0) + COALESCE(NEW.meals_dinner, 0);
BEGIN
  IF NEW.status IN ('active', 'paused') THEN
    -- NEW's own counts: in a BEFORE trigger the row isn't written yet.
    v_drinks := CASE WHEN NEW.drinks_lunch > 0 THEN NEW.drinks_lunch
                     WHEN plan_has_drink(NEW.id) THEN COALESCE(NEW.meals_lunch, 0) ELSE 0 END
              + CASE WHEN NEW.drinks_dinner > 0 THEN NEW.drinks_dinner
                     WHEN plan_has_drink(NEW.id) THEN COALESCE(NEW.meals_dinner, 0) ELSE 0 END;
    NEW.deliveries_remaining := meals_left_for(
      NEW.user_id,
      v_rate + plan_meal_addons_price(NEW.id) + (drink_price() * v_drinks) / GREATEST(v_meals, 1),
      NEW.cod_due_paise);
  END IF;
  RETURN NEW;
END; $$;

-- Does the plan deliver this slot that day (so the minimum applies)?
CREATE OR REPLACE FUNCTION public.slot_default_applies(p_sub uuid, p_date date, p_slot text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s      record;
  v_rows integer;
BEGIN
  SELECT * INTO s FROM subscriptions WHERE id = p_sub;
  IF NOT FOUND OR s.status NOT IN ('active', 'paused') THEN RETURN false; END IF;
  IF plan_slot_meals(p_sub, p_slot) <= 0 THEN RETURN false; END IF;
  IF s.start_date IS NOT NULL AND p_date < s.start_date THEN RETURN false; END IF;
  IF s.pause_from IS NOT NULL AND s.pause_until IS NOT NULL AND p_date BETWEEN s.pause_from AND s.pause_until THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM kitchen_closures WHERE closed_on = p_date AND meal_slot = p_slot) THEN RETURN false; END IF;
  SELECT count(*) INTO v_rows FROM subscription_schedule WHERE subscription_id = p_sub;
  IF v_rows > 0 THEN
    RETURN EXISTS (SELECT 1 FROM subscription_schedule
                    WHERE subscription_id = p_sub AND day_of_week = trim(to_char(p_date, 'Dy')));
  END IF;
  RETURN NOT COALESCE(s.no_delivery_days, false) AND extract(isodow FROM p_date) <> 7;
END; $$;

-- The day's drink for a slot: the kitchen's weekly pick when it can be
-- delivered, else any deliverable drink (the plan paid for one).
CREATE OR REPLACE FUNCTION public.slot_default_drink(p_date date, p_slot text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT w.drink_template_id FROM weekly_menu w
      WHERE w.menu_type = 'M1' AND w.meal_slot = p_slot
        AND w.day_of_week = extract(isodow FROM p_date)::int - 1
        AND is_deliverable_drink(w.drink_template_id)),
    (SELECT t.id FROM meal_templates t
      WHERE t.is_active AND t.subscription_valid AND t.category = 'smoothie' ORDER BY t.name LIMIT 1))
$$;

-- What the default cart for a slot costs (the order run checks the wallet).
CREATE OR REPLACE FUNCTION public.default_slot_cost(p_sub uuid, p_date date, p_slot text)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT plan_slot_meals(s.id, p_slot)
           * (subscription_meal_rate(s.id) + plan_meal_addons_price(s.id)
              + COALESCE((SELECT premium_paise FROM meal_templates
                           WHERE id = plan_default_dish(s.user_id, p_date, p_slot)), 0))
         + plan_slot_drinks(s.id, p_slot) * drink_price()
    FROM subscriptions s WHERE s.id = p_sub
$$;

-- Makes a slot's default cart: M × the day's dish (with the plan's add-ons)
-- and D × the day's drink. Returns the items made (0 when the menu has no dish).
CREATE OR REPLACE FUNCTION public.make_default_cart(p_sub uuid, p_date date, p_slot text, p_address uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s       record;
  v_m     integer := plan_slot_meals(p_sub, p_slot);
  v_d     integer := plan_slot_drinks(p_sub, p_slot);
  v_dish  text;
  v_drink text;
  v_seq   integer;
  v_id    uuid;
  n       integer := 0;
BEGIN
  SELECT id, user_id INTO s FROM subscriptions WHERE id = p_sub;
  IF NOT FOUND OR v_m <= 0 THEN RETURN 0; END IF;
  -- The customer's / office's fixed dish, then the weekly menu, then the
  -- plan's own dish for that weekday (subscription_schedule) when the menu has none.
  v_dish := COALESCE(plan_default_dish(s.user_id, p_date, p_slot),
                     (SELECT meal_template_id FROM subscription_schedule
                       WHERE subscription_id = p_sub AND day_of_week = trim(to_char(p_date, 'Dy'))));
  IF v_dish IS NULL THEN RETURN 0; END IF;

  SELECT COALESCE(max(slot_seq) + 1, 0) INTO v_seq FROM orders
   WHERE subscription_id = p_sub AND delivery_date = p_date AND meal_slot = p_slot AND NOT walk_in;

  INSERT INTO orders (user_id, subscription_id, meal_template_id, delivery_date, meal_slot, status,
                      quantity, unit_price, item_kind, extra_dish, slot_seq, is_customized, address_id)
  VALUES (s.user_id, p_sub, v_dish, p_date, p_slot, 'scheduled',
          v_m, item_unit_price(p_sub, v_dish), 'meal', false, v_seq,
          plan_rule_dish(s.user_id, p_date, p_slot) IS NOT NULL, p_address)
  RETURNING id INTO v_id;
  PERFORM snapshot_order_ingredients(v_id);
  INSERT INTO order_addons (order_id, addon_id, sub_option, quantity, unit_price, is_plan)
  SELECT v_id, sa.addon_id, sa.sub_option, v_m, a.price_per_meal, true
    FROM subscription_addons sa JOIN addons a ON a.id = sa.addon_id
   WHERE sa.subscription_id = p_sub AND NOT a.is_drink;
  PERFORM recompute_order_cart(v_id);
  n := 1;

  IF v_d > 0 THEN
    v_drink := slot_default_drink(p_date, p_slot);
    IF v_drink IS NOT NULL THEN
      INSERT INTO orders (user_id, subscription_id, meal_template_id, delivery_date, meal_slot, status,
                          quantity, unit_price, item_kind, extra_dish, slot_seq, address_id)
      VALUES (s.user_id, p_sub, v_drink, p_date, p_slot, 'scheduled',
              v_d, drink_price(), 'drink', true, v_seq + 1, p_address)
      RETURNING id INTO v_id;
      PERFORM snapshot_order_ingredients(v_id);
      PERFORM recompute_order_cart(v_id);
      n := n + 1;
    END IF;
  END IF;
  RETURN n;
END; $$;

-- ── The minimum ─────────────────────────────────────────────────────────────
-- A slot's cart against the plan's default, from what's saved.
CREATE OR REPLACE FUNCTION public.slot_cart_state(p_sub uuid, p_date date, p_slot text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH items AS (
    SELECT o.id, o.item_kind, COALESCE(o.quantity, 1) AS qty
      FROM orders o
     WHERE o.subscription_id = p_sub AND o.delivery_date = p_date AND o.meal_slot = p_slot
       AND NOT o.walk_in AND o.status IN ('scheduled', 'confirmed', 'preparing')
  ), plan_addons AS (
    SELECT sa.addon_id,
           COALESCE((SELECT SUM(oa.quantity) FROM order_addons oa JOIN items i ON i.id = oa.order_id
                      WHERE i.item_kind = 'meal' AND oa.addon_id = sa.addon_id), 0)::integer AS have
      FROM subscription_addons sa JOIN addons a ON a.id = sa.addon_id
     WHERE sa.subscription_id = p_sub AND NOT a.is_drink
  )
  SELECT jsonb_build_object(
    'applies', slot_default_applies(p_sub, p_date, p_slot),
    'need_meals', plan_slot_meals(p_sub, p_slot),
    'need_drinks', plan_slot_drinks(p_sub, p_slot),
    'meals', COALESCE((SELECT SUM(qty) FROM items WHERE item_kind = 'meal'), 0),
    'drinks', COALESCE((SELECT SUM(qty) FROM items WHERE item_kind = 'drink'), 0),
    'items', (SELECT count(*) FROM items),
    'plan_addons', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', addon_id, 'have', have)) FROM plan_addons), '[]'::jsonb))
$$;
GRANT EXECUTE ON FUNCTION public.slot_cart_state(uuid, date, text) TO service_role;

-- NULL when the slot's cart is fine, else why not. An empty (skipped) slot is fine.
CREATE OR REPLACE FUNCTION public.slot_cart_problem(p_sub uuid, p_date date, p_slot text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  st jsonb := slot_cart_state(p_sub, p_date, p_slot);
  pa jsonb;
BEGIN
  IF NOT (st->>'applies')::boolean OR (st->>'items')::int = 0 THEN RETURN NULL; END IF;
  IF (st->>'meals')::int < (st->>'need_meals')::int THEN
    RETURN format('Your plan has %s meal%s here — swap a dish instead, or skip this meal.',
                  st->>'need_meals', CASE WHEN (st->>'need_meals')::int = 1 THEN '' ELSE 's' END);
  END IF;
  IF (st->>'drinks')::int < (st->>'need_drinks')::int THEN
    RETURN format('Your plan has %s drink%s here — pick another drink instead, or skip this meal.',
                  st->>'need_drinks', CASE WHEN (st->>'need_drinks')::int = 1 THEN '' ELSE 's' END);
  END IF;
  FOR pa IN SELECT * FROM jsonb_array_elements(st->'plan_addons') LOOP
    IF (pa->>'have')::int < (st->>'need_meals')::int THEN
      RETURN format('%s comes with your plan''s meals and can''t be removed.',
                    (SELECT name FROM addons WHERE id = pa->>'id'));
    END IF;
  END LOOP;
  RETURN NULL;
END; $$;
GRANT EXECUTE ON FUNCTION public.slot_cart_problem(uuid, date, text) TO service_role;

-- ── Saving a cart (Customize) ───────────────────────────────────────────────
-- p_items: [{"kind":"meal","dish":"burrito-bowl","qty":2,
--            "addons":[{"id":"seeds","qty":2,"option":null}]},
--           {"kind":"drink","dish":"avo-clarity","qty":1}]
CREATE OR REPLACE FUNCTION public.save_day_cart(p_sub uuid, p_date date, p_slot text, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s          record;
  it         jsonb;
  ad         jsonb;
  v_applies  boolean;
  v_need_m   integer := plan_slot_meals(p_sub, p_slot);
  v_need_d   integer := plan_slot_drinks(p_sub, p_slot);
  v_meals    integer := 0;
  v_drinks   integer := 0;
  v_new      integer := 0;
  v_old      integer;
  v_addr     uuid;
  v_seq      integer;
  v_id       uuid;
  v_first    boolean := true;
  v_kind     text;
  v_dish     text;
  v_qty      integer;
  v_aqty     integer;
  pa         record;
  v_have     integer;
BEGIN
  SELECT * INTO s FROM subscriptions WHERE id = p_sub;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan not found.'; END IF;
  IF COALESCE(auth.role(), '') = 'authenticated' AND s.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Plan not found.';
  END IF;
  IF s.status NOT IN ('active', 'paused') THEN RAISE EXCEPTION 'Your plan isn''t running.'; END IF;
  IF p_slot NOT IN ('lunch', 'dinner') THEN RAISE EXCEPTION 'Pick lunch or dinner.'; END IF;
  IF is_slot_locked(p_date, p_slot) THEN
    RAISE EXCEPTION 'This meal is already being prepared — changes close at 9 AM for lunch and 2 PM for dinner.';
  END IF;
  IF EXISTS (SELECT 1 FROM kitchen_closures WHERE closed_on = p_date AND meal_slot = p_slot) THEN
    RAISE EXCEPTION 'The kitchen is closed for this meal.';
  END IF;
  IF s.pause_from IS NOT NULL AND s.pause_until IS NOT NULL AND p_date BETWEEN s.pause_from AND s.pause_until THEN
    RAISE EXCEPTION 'Your plan is paused that day.';
  END IF;
  v_applies := slot_default_applies(p_sub, p_date, p_slot);
  IF extract(isodow FROM p_date) = 7 AND NOT v_applies THEN
    RAISE EXCEPTION 'Sunday is our day off — message us on WhatsApp if you need something special.';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Your cart is empty — to have no meal, skip it instead.';
  END IF;

  -- Validate and price.
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_kind := it->>'kind';
    v_dish := it->>'dish';
    v_qty  := COALESCE((it->>'qty')::int, 0);
    IF v_qty < 1 OR v_qty > 10 THEN RAISE EXCEPTION 'Pick 1 to 10 of each item.'; END IF;
    IF v_kind = 'drink' THEN
      IF NOT is_deliverable_drink(v_dish) THEN RAISE EXCEPTION 'That drink isn''t available.'; END IF;
      IF it ? 'addons' AND jsonb_array_length(COALESCE(it->'addons', '[]')) > 0 THEN
        RAISE EXCEPTION 'Drinks don''t take add-ons.';
      END IF;
      v_drinks := v_drinks + v_qty;
      v_new := v_new + drink_price() * v_qty;
    ELSIF v_kind = 'meal' THEN
      IF NOT EXISTS (SELECT 1 FROM meal_templates WHERE id = v_dish AND is_active AND subscription_valid
                                                    AND category NOT IN ('smoothie', 'coffee')) THEN
        RAISE EXCEPTION 'One of those dishes isn''t available for plans.';
      END IF;
      IF EXISTS (SELECT 1 FROM meal_availability WHERE for_date = p_date AND meal_template_id = v_dish AND NOT is_available) THEN
        RAISE EXCEPTION '% isn''t available that day.', (SELECT name FROM meal_templates WHERE id = v_dish);
      END IF;
      v_meals := v_meals + v_qty;
      v_new := v_new + item_unit_price(p_sub, v_dish) * v_qty;
      FOR ad IN SELECT * FROM jsonb_array_elements(COALESCE(it->'addons', '[]')) LOOP
        v_aqty := COALESCE((ad->>'qty')::int, 0);
        IF v_aqty < 1 OR v_aqty > 10 THEN RAISE EXCEPTION 'Pick 1 to 10 of each add-on.'; END IF;
        IF NOT EXISTS (SELECT 1 FROM addons WHERE id = ad->>'id' AND is_active AND NOT is_drink) THEN
          RAISE EXCEPTION 'One of those add-ons isn''t available.';
        END IF;
        v_new := v_new + (SELECT price_per_meal FROM addons WHERE id = ad->>'id') * v_aqty;
      END LOOP;
    ELSE
      RAISE EXCEPTION 'Unknown item.';
    END IF;
  END LOOP;

  -- The minimum.
  IF v_applies THEN
    IF v_meals < v_need_m THEN
      RAISE EXCEPTION 'Your plan has % meal% here — add % more, or skip this meal.',
        v_need_m, CASE WHEN v_need_m = 1 THEN '' ELSE 's' END, v_need_m - v_meals;
    END IF;
    IF v_drinks < v_need_d THEN
      RAISE EXCEPTION 'Your plan has % drink% here — add % more, or skip this meal.',
        v_need_d, CASE WHEN v_need_d = 1 THEN '' ELSE 's' END, v_need_d - v_drinks;
    END IF;
    FOR pa IN SELECT sa.addon_id, a.name FROM subscription_addons sa JOIN addons a ON a.id = sa.addon_id
               WHERE sa.subscription_id = p_sub AND NOT a.is_drink LOOP
      SELECT COALESCE(SUM((x->>'qty')::int), 0) INTO v_have
        FROM jsonb_array_elements(p_items) i, jsonb_array_elements(COALESCE(i->'addons', '[]')) x
       WHERE i->>'kind' = 'meal' AND x->>'id' = pa.addon_id;
      IF v_have < v_need_m THEN
        RAISE EXCEPTION '% comes with your plan''s meals — keep it on % meal%.',
          pa.name, v_need_m, CASE WHEN v_need_m = 1 THEN '' ELSE 's' END;
      END IF;
    END LOOP;
  END IF;

  -- Wallet: what this adds over the cart it replaces.
  SELECT COALESCE(SUM(recompute_order_cart(o.id)), 0)::integer INTO v_old FROM orders o
   WHERE o.subscription_id = p_sub AND o.delivery_date = p_date AND o.meal_slot = p_slot
     AND NOT o.walk_in AND o.status IN ('scheduled', 'confirmed');
  IF v_new > v_old AND NOT COALESCE(s.cod_on_credit, false) AND v_new - v_old > schedulable_paise(s.user_id) THEN
    RAISE EXCEPTION 'Your wallet doesn''t cover these extras — remove something, or renew your plan.';
  END IF;

  -- Replace the slot's open items.
  SELECT address_id INTO v_addr FROM orders
   WHERE subscription_id = p_sub AND delivery_date = p_date AND meal_slot = p_slot AND NOT walk_in
     AND address_id IS NOT NULL
   ORDER BY (status IN ('scheduled', 'confirmed')) DESC, extra_dish, slot_seq LIMIT 1;
  IF v_addr IS NULL THEN
    SELECT id INTO v_addr FROM addresses WHERE user_id = s.user_id AND archived_at IS NULL
     ORDER BY is_default DESC, created_at LIMIT 1;
  END IF;
  DELETE FROM orders
   WHERE subscription_id = p_sub AND delivery_date = p_date AND meal_slot = p_slot
     AND NOT walk_in AND status IN ('scheduled', 'confirmed');
  SELECT COALESCE(max(slot_seq) + 1, 0) INTO v_seq FROM orders
   WHERE subscription_id = p_sub AND delivery_date = p_date AND meal_slot = p_slot AND NOT walk_in;

  -- Meals first (the first one is the slot's "base" for older readers), then drinks.
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) ORDER BY (value->>'kind') DESC LOOP
    v_kind := it->>'kind';
    v_dish := it->>'dish';
    v_qty  := (it->>'qty')::int;
    INSERT INTO orders (user_id, subscription_id, meal_template_id, delivery_date, meal_slot, status,
                        quantity, unit_price, item_kind, extra_dish, slot_seq, is_customized, cart_edited, address_id)
    VALUES (s.user_id, p_sub, v_dish, p_date, p_slot, 'scheduled',
            v_qty, item_unit_price(p_sub, v_dish), v_kind, NOT (v_first AND v_kind = 'meal'), v_seq,
            true, true, v_addr)
    RETURNING id INTO v_id;
    v_first := false;
    v_seq := v_seq + 1;
    PERFORM snapshot_order_ingredients(v_id);
    IF v_kind = 'meal' THEN
      INSERT INTO order_addons (order_id, addon_id, sub_option, quantity, unit_price, is_plan)
      SELECT v_id, x->>'id', NULLIF(x->>'option', ''), (x->>'qty')::int, a.price_per_meal,
             EXISTS (SELECT 1 FROM subscription_addons sa WHERE sa.subscription_id = p_sub AND sa.addon_id = a.id)
        FROM jsonb_array_elements(COALESCE(it->'addons', '[]')) x JOIN addons a ON a.id = x->>'id';
    END IF;
    PERFORM recompute_order_cart(v_id);
  END LOOP;

  RETURN slot_cart_state(p_sub, p_date, p_slot) || jsonb_build_object('total', v_new);
END; $$;
REVOKE ALL ON FUNCTION public.save_day_cart(uuid, date, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_day_cart(uuid, date, text, jsonb) TO authenticated, service_role;

-- What the app needs to draw Customize: the default, prices, what's saved.
CREATE OR REPLACE FUNCTION public.my_slot_cart(p_date date, p_slot text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sub uuid;
BEGIN
  SELECT id INTO v_sub FROM subscriptions WHERE user_id = auth.uid() AND status IN ('active', 'paused')
   ORDER BY created_at DESC LIMIT 1;
  IF v_sub IS NULL THEN RETURN NULL; END IF;
  RETURN slot_cart_state(v_sub, p_date, p_slot) || jsonb_build_object(
    'subscription_id', v_sub,
    'locked', is_slot_locked(p_date, p_slot),
    'meal_price', subscription_meal_rate(v_sub),
    'drink_price', drink_price(),
    'plan_addon_ids', COALESCE((SELECT jsonb_agg(sa.addon_id) FROM subscription_addons sa JOIN addons a ON a.id = sa.addon_id
                                 WHERE sa.subscription_id = v_sub AND NOT a.is_drink), '[]'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.my_slot_cart(date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_slot_cart(date, text) TO authenticated;

-- ── Keeping the plan's open carts in line with its defaults (080/088/089) ───
-- A slot nobody changed by hand is remade from the default; a slot now off
-- is cancelled ('off_day'). Any hand-changed item leaves the whole slot alone.
CREATE OR REPLACE FUNCTION public.resync_plan_orders(p_sub uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g         record;
  v_today   date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_updated integer := 0;
  v_off     integer := 0;
BEGIN
  FOR g IN
    SELECT delivery_date, meal_slot,
           (array_agg(address_id ORDER BY extra_dish, slot_seq) FILTER (WHERE address_id IS NOT NULL))[1] AS addr,
           bool_or(cart_edited) AS edited
      FROM orders
     WHERE subscription_id = p_sub AND status IN ('scheduled', 'confirmed')
       AND delivery_date >= v_today AND NOT walk_in
     GROUP BY delivery_date, meal_slot
     ORDER BY delivery_date, meal_slot
  LOOP
    CONTINUE WHEN g.edited OR is_slot_locked(g.delivery_date, g.meal_slot);
    IF NOT slot_default_applies(p_sub, g.delivery_date, g.meal_slot) THEN
      UPDATE orders SET status = 'cancelled', skip_reason = 'off_day', updated_at = now()
       WHERE subscription_id = p_sub AND delivery_date = g.delivery_date AND meal_slot = g.meal_slot
         AND status IN ('scheduled', 'confirmed') AND NOT walk_in;
      v_off := v_off + 1;
      CONTINUE;
    END IF;
    DELETE FROM orders
     WHERE subscription_id = p_sub AND delivery_date = g.delivery_date AND meal_slot = g.meal_slot
       AND status IN ('scheduled', 'confirmed') AND NOT walk_in;
    PERFORM make_default_cart(p_sub, g.delivery_date, g.meal_slot, g.addr);
    v_updated := v_updated + 1;
  END LOOP;
  RETURN jsonb_build_object('updated', v_updated, 'dish_changed', 0, 'cancelled', v_off);
END; $$;
REVOKE ALL ON FUNCTION public.resync_plan_orders(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resync_plan_orders(uuid) TO service_role;

-- ── Older writers that add a drink as an add-on line (old apps, 096) ────────
-- A drink line on a delivery item becomes a drink item in the same slot.
DROP TRIGGER IF EXISTS order_addons_weekly_drink ON public.order_addons;
CREATE OR REPLACE FUNCTION public.order_addons_drink_to_item()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o       record;
  v_drink text;
  v_seq   integer;
  v_id    uuid;
BEGIN
  IF NEW.kind IS DISTINCT FROM 'addon' OR NEW.addon_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM addons WHERE id = NEW.addon_id AND is_drink) THEN
    RETURN NEW;
  END IF;
  SELECT * INTO o FROM orders WHERE id = NEW.order_id;
  IF NOT FOUND OR o.walk_in THEN RETURN NEW; END IF;   -- walk-ins keep their drink line
  v_drink := COALESCE(o.drink_template_id, slot_default_drink(o.delivery_date, o.meal_slot));
  IF v_drink IS NULL THEN RETURN NEW; END IF;
  SELECT COALESCE(max(slot_seq) + 1, 0) INTO v_seq FROM orders
   WHERE subscription_id = o.subscription_id AND delivery_date = o.delivery_date AND meal_slot = o.meal_slot AND NOT walk_in;
  INSERT INTO orders (user_id, subscription_id, meal_template_id, delivery_date, meal_slot, status,
                      quantity, unit_price, item_kind, extra_dish, slot_seq, cart_edited, address_id)
  VALUES (o.user_id, o.subscription_id, v_drink, o.delivery_date, o.meal_slot, o.status,
          COALESCE(NEW.quantity, 1), drink_price(), 'drink', true, v_seq, true, o.address_id)
  RETURNING id INTO v_id;
  PERFORM recompute_order_cart(v_id);
  RETURN NULL;   -- no add-on line: the drink is its own item
END; $$;
REVOKE ALL ON FUNCTION public.order_addons_drink_to_item() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER order_addons_drink_to_item
  BEFORE INSERT ON public.order_addons
  FOR EACH ROW EXECUTE FUNCTION public.order_addons_drink_to_item();

-- ── Switch-over: open meals to items, same totals ───────────────────────────
-- Included plan add-ons (unit_price NULL, once per portion) come out of the
-- meal's price and become priced lines; a drink line becomes a drink item at
-- the same money. On an extra dish the included lines were free, so they stay
-- free (priced 0). Walk-ins keep their own shape (087).
DO $sw$
DECLARE
  o        record;
  l        record;
  v_less   integer;
  v_drinks integer;
  v_dprice integer;
  v_drink  text;
  v_seq    integer;
  v_id     uuid;
  v_q      integer;
BEGIN
  FOR o IN
    SELECT * FROM orders
     WHERE status IN ('scheduled', 'confirmed', 'preparing')
       AND delivery_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
       AND NOT walk_in AND item_kind = 'meal'
     ORDER BY delivery_date, meal_slot, slot_seq
     FOR UPDATE
  LOOP
    v_less := 0;
    v_drinks := 0;
    v_dprice := 0;
    v_q := COALESCE(o.quantity, 1);
    FOR l IN SELECT oa.id, oa.quantity, oa.unit_price, oa.addon_id, a.price_per_meal, a.is_drink
               FROM order_addons oa JOIN addons a ON a.id = oa.addon_id
              WHERE oa.order_id = o.id AND oa.kind = 'addon' LOOP
      IF l.unit_price IS NULL THEN
        IF NOT o.extra_dish THEN
          v_less := v_less + l.price_per_meal * COALESCE(l.quantity, 1);
        END IF;
        IF l.is_drink THEN
          v_drinks := v_drinks + COALESCE(l.quantity, 1) * CASE WHEN o.extra_dish THEN 1 ELSE v_q END;
          v_dprice := CASE WHEN o.extra_dish THEN 0 ELSE l.price_per_meal END;
          DELETE FROM order_addons WHERE id = l.id;
        ELSE
          UPDATE order_addons
             SET unit_price = CASE WHEN o.extra_dish THEN 0 ELSE l.price_per_meal END,
                 quantity = COALESCE(l.quantity, 1) * CASE WHEN o.extra_dish THEN 1 ELSE v_q END,
                 is_plan = NOT o.extra_dish AND EXISTS (SELECT 1 FROM subscription_addons sa
                                                         WHERE sa.subscription_id = o.subscription_id AND sa.addon_id = l.addon_id)
           WHERE id = l.id;
        END IF;
      ELSIF l.is_drink THEN
        -- A drink added as a priced line (Ashok, 19 Nov): its own item, same price.
        v_drinks := v_drinks + COALESCE(l.quantity, 1);
        v_dprice := l.unit_price;
        DELETE FROM order_addons WHERE id = l.id;
      END IF;
    END LOOP;

    IF v_less > 0 THEN
      UPDATE orders SET unit_price = COALESCE(unit_price, 0) - v_less WHERE id = o.id;
    END IF;

    IF v_drinks > 0 THEN
      v_drink := CASE WHEN o.drink_template_id IS NOT NULL AND is_deliverable_drink(o.drink_template_id)
                      THEN o.drink_template_id ELSE slot_default_drink(o.delivery_date, o.meal_slot) END;
      SELECT COALESCE(max(slot_seq) + 1, 0) INTO v_seq FROM orders
       WHERE subscription_id = o.subscription_id AND delivery_date = o.delivery_date
         AND meal_slot = o.meal_slot AND NOT walk_in;
      INSERT INTO orders (user_id, subscription_id, meal_template_id, delivery_date, meal_slot, status,
                          quantity, unit_price, item_kind, extra_dish, slot_seq, is_customized, cart_edited,
                          address_id, batch_id)
      VALUES (o.user_id, o.subscription_id, v_drink, o.delivery_date, o.meal_slot, o.status,
              v_drinks, v_dprice, 'drink', true, v_seq, o.drink_edited, o.cart_edited,
              o.address_id, o.batch_id)
      RETURNING id INTO v_id;
      PERFORM snapshot_order_ingredients(v_id);
      PERFORM recompute_order_cart(v_id);
      UPDATE orders SET drink_template_id = NULL WHERE id = o.id;
    END IF;
    PERFORM recompute_order_cart(o.id);
  END LOOP;
END $sw$;

NOTIFY pgrst, 'reload schema';
