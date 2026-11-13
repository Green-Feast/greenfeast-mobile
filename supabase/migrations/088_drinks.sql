-- ============================================================
-- GreenFeast — Migration 088: drinks (a smoothie or coffee with the meal)
-- ============================================================
-- A drink is a meal_templates row (category 'smoothie' or 'coffee') — no new
-- catalogue. The hard-coded smoothie flavour lists retire: the kitchen picks one
-- drink per slot in the weekly grid, a subscriber can swap the day's drink in
-- Customize, and a walk-in picks one at the counter.
--
--   Entitlement and price stay exactly where they were. A plan "has a drink"
--   when it has a subscription_addons row whose addon has addons.is_drink — today
--   the 'smoothie' add-on. Every pricing site (addons_per_meal, default_meal_cost,
--   instantiate-orders, cashfree-create-order, renewals, admin plan totals) keeps
--   working unchanged; the UI just groups that add-on as "Drink".
--
--   The day's drink lives on the order: orders.drink_template_id, snapshotted
--   like meal_template_id. The order's drink add-on line keeps
--   sub_option = <drink name>, so name-only readers (Operations PDFs, the partner
--   app, Counter) keep showing the right drink. NULL = chef's choice (the
--   line's sub_option, if any, is the legacy flavour text).
--
--   Deliverable drink = is_active AND subscription_valid (the toggle the admin
--   already sets in the Menu tab). Coffees are dine-in only today
--   (subscription_valid = false), so they only appear at walk-in.
--
-- NO FOREIGN KEYS on the two new drink_template_id columns, on purpose: a second
-- FK from orders / weekly_menu to meal_templates makes every existing PostgREST
-- embed `meal_templates(...)` on those tables ambiguous (PGRST201) and breaks the
-- app builds already in customers' hands. A trigger validates the value instead;
-- readers fetch the drink dish separately, by id.
--
-- Applied directly (never `db push`): rolled-back DRYRUN first, then
-- `supabase db query --linked -f`.

-- ── 1. Columns ──────────────────────────────────────────────────────────────
ALTER TABLE public.addons ADD COLUMN IF NOT EXISTS is_drink boolean NOT NULL DEFAULT false;
UPDATE public.addons SET is_drink = true WHERE id = 'smoothie' AND NOT is_drink;

ALTER TABLE public.weekly_menu ADD COLUMN IF NOT EXISTS drink_template_id text;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS drink_template_id text,
  ADD COLUMN IF NOT EXISTS drink_edited boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.addons.is_drink IS
  '088: this add-on is the plan''s drink (a smoothie or coffee dish with every meal). The UI shows it as "Drink", not as an add-on; its price is unchanged.';
COMMENT ON COLUMN public.weekly_menu.drink_template_id IS
  '088: the drink (meal_templates id, category smoothie/coffee) for this day and slot. No FK on purpose (PGRST201); validated by trigger check_drink_template. NULL = chef''s choice.';
COMMENT ON COLUMN public.orders.drink_template_id IS
  '088: the drink for this order (meal_templates id, category smoothie/coffee), snapshotted from weekly_menu. No FK on purpose (PGRST201); validated by trigger check_drink_template. NULL = chef''s choice. The drink add-on line''s sub_option carries its name.';
COMMENT ON COLUMN public.orders.drink_edited IS
  '088: the drink was swapped by hand (customer or admin), so kitchen menu propagation leaves this order''s drink alone.';

-- ── 2. Validation trigger (instead of a foreign key) ────────────────────────
-- Fires only when the column is written and the value actually changes, so an
-- old order whose drink dish was later archived can still be updated. It checks
-- the dish is a drink (category smoothie / coffee), not that it is deliverable —
-- that depends on the caller (is_deliverable_drink).
CREATE OR REPLACE FUNCTION public.check_drink_template()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.drink_template_id := NULLIF(btrim(NEW.drink_template_id), '');
  IF NEW.drink_template_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.drink_template_id IS NOT DISTINCT FROM OLD.drink_template_id THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM meal_templates t
                  WHERE t.id = NEW.drink_template_id AND t.category IN ('smoothie', 'coffee')) THEN
    RAISE EXCEPTION '% is not a drink (it must be a smoothie or coffee dish).', NEW.drink_template_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.check_drink_template() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS orders_check_drink_template ON public.orders;
CREATE TRIGGER orders_check_drink_template
  BEFORE INSERT OR UPDATE OF drink_template_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.check_drink_template();

DROP TRIGGER IF EXISTS weekly_menu_check_drink_template ON public.weekly_menu;
CREATE TRIGGER weekly_menu_check_drink_template
  BEFORE INSERT OR UPDATE OF drink_template_id ON public.weekly_menu
  FOR EACH ROW EXECUTE FUNCTION public.check_drink_template();

-- ── 3. Helpers ──────────────────────────────────────────────────────────────
-- A drink that can go on a delivery: switched on, and valid for subscriptions.
CREATE OR REPLACE FUNCTION public.is_deliverable_drink(p_drink text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM meal_templates t
     WHERE t.id = p_drink AND t.is_active AND t.subscription_valid
       AND t.category IN ('smoothie', 'coffee'))
$$;
REVOKE ALL ON FUNCTION public.is_deliverable_drink(text) FROM PUBLIC, anon, authenticated;

-- Does this order carry the plan's drink (a drink add-on line)?
CREATE OR REPLACE FUNCTION public.order_has_drink(p_order uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM order_addons oa JOIN addons ad ON ad.id = oa.addon_id
     WHERE oa.order_id = p_order AND oa.kind = 'addon' AND ad.is_drink)
$$;
REVOKE ALL ON FUNCTION public.order_has_drink(uuid) FROM PUBLIC, anon, authenticated;

-- ── 4. order_addon_lines (060): a flavour / drink shows beside the name ─────
-- "Smoothie (Blue Mind)", "Smoothie (Blue Mind) ×2", "Extra Cheese (Feta)".
-- Signature, grants and SECURITY DEFINER as in 060; lines without a sub_option
-- render exactly as before.
CREATE OR REPLACE FUNCTION public.order_addon_lines(p_order uuid, p_qty integer, p_extra boolean)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(CASE WHEN n > 1 THEN label || ' ×' || n ELSE label END ORDER BY name, label), '[]'::jsonb)
    FROM (
      SELECT ad.name,
             CASE WHEN NULLIF(btrim(oa.sub_option), '') IS NOT NULL
                  THEN ad.name || ' (' || btrim(oa.sub_option) || ')'
                  ELSE ad.name END AS label,
             COALESCE(oa.quantity, 1) * CASE WHEN oa.unit_price IS NULL AND NOT p_extra THEN p_qty ELSE 1 END AS n
        FROM public.order_addons oa
        JOIN public.addons ad ON ad.id = oa.addon_id
       WHERE oa.order_id = p_order AND oa.kind = 'addon'
    ) lines;
$$;
REVOKE ALL ON FUNCTION public.order_addon_lines(uuid, integer, boolean) FROM PUBLIC, anon, authenticated;

-- ── 5. resync_plan_orders (087): keep the day's drink name ──────────────────
-- A default change (portions, days, dishes) rebuilds each open, unedited day's
-- plan add-on lines from subscription_addons. For the drink line that would
-- put the plan's legacy flavour back over the kitchen's drink, so it now takes
-- the name of the order's drink (orders.drink_template_id) when there is one.
-- Otherwise identical to 087.
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

-- ── 6. A drink is never the meal ────────────────────────────────────────────
-- Once the admin marks drinks subscription_valid, a smoothie or coffee passes the
-- "valid for plans" checks, so the server paths that take a dish refuse the drink
-- categories outright (add-dish and switch-meal do the same in the edge
-- functions; the admin's pickers hide them). This is the customer's dish rule:
-- 080's set_my_meal_rule, otherwise unchanged.
CREATE OR REPLACE FUNCTION public.set_my_meal_rule(p_slot text, p_day integer, p_meal text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  IF p_meal IS NOT NULL AND EXISTS (
       SELECT 1 FROM meal_templates WHERE id = p_meal AND category IN ('smoothie', 'coffee')) THEN
    RAISE EXCEPTION 'A drink can''t be your meal — pick a dish. Your drink comes with it.';
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

-- ── 7. Walk-in (087) ────────────────────────────────────────────────────────
-- A drink a walk-in can have: switched on, a smoothie or coffee, and not marked
-- unavailable today. (Like walk_in_dish_ok, minus menu_visible; a coffee is fine
-- here — walk-in is eaten at the café or taken away. subscription_valid doesn't
-- matter either: that is about delivery.)
CREATE OR REPLACE FUNCTION public.walk_in_drink_ok(p_drink text, p_date date)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM meal_templates t
     WHERE t.id = p_drink AND t.is_active AND t.category IN ('smoothie', 'coffee')
       AND NOT EXISTS (SELECT 1 FROM meal_availability a
                        WHERE a.for_date = p_date AND a.meal_template_id = t.id AND NOT a.is_available))
$$;
REVOKE ALL ON FUNCTION public.walk_in_drink_ok(text, date) FROM PUBLIC, anon, authenticated;

-- walk_in_quote: each add-on now says whether it is the drink ("is_drink"), and
-- "drinks" lists exactly the drinks start_walk_in will accept today (the chips
-- for the Walk-in sheet). "dishes" is 087's, unchanged — it still contains the
-- smoothie / coffee dishes (tagged by category) for older app builds, but
-- start_walk_in now refuses one as the meal. Everything else is 087's.
CREATE OR REPLACE FUNCTION public.walk_in_quote(p_location text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_today  date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_sub    uuid;
  l        public.pickup_locations;
  v_slot   text;
  v_def    text;
  v_dish   text;
  v_cost   integer;
  v_ports  integer[];
  v_addons jsonb;
BEGIN
  BEGIN
    v_sub := pickup_plan_for(v_user);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'eligible', false, 'error', SQLERRM);
  END;
  SELECT * INTO l FROM pickup_locations WHERE id = p_location AND is_active;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'eligible', true, 'error', 'That place isn''t taking walk-ins.'); END IF;

  v_slot := COALESCE(pickup_slot_now(p_location),
                     CASE WHEN (now() AT TIME ZONE 'Asia/Kolkata')::time < l.lunch_until THEN 'lunch' ELSE 'dinner' END);
  v_def := walk_in_default_slot(v_sub, v_slot);
  v_dish := plan_default_dish(v_user, v_today, v_def);
  v_cost := default_meal_cost(v_sub);
  v_ports := walk_in_portions(v_sub, v_def);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', ad.id, 'name', ad.name, 'sub_option', sa.sub_option, 'is_drink', ad.is_drink)
           ORDER BY ad.name), '[]'::jsonb)
    INTO v_addons
    FROM subscription_addons sa JOIN addons ad ON ad.id = sa.addon_id
   WHERE sa.subscription_id = v_sub;

  RETURN jsonb_build_object(
    'ok', true,
    'eligible', true,
    'open_now', pickup_slot_now(p_location) IS NOT NULL,
    'place', l.name,
    'address', l.address,
    'maps_url', l.maps_url,
    'opens', to_char(l.opens_at, 'FMHH12:MI AM'),
    'closes', to_char(l.closes_at, 'FMHH12:MI AM'),
    'offers_pickup', l.offers_pickup,
    'offers_dine_in', l.offers_dine_in,
    'default_meal_id', v_dish,
    'default_meal_name', (SELECT name FROM meal_templates WHERE id = v_dish),
    'default_meal_ok', v_dish IS NOT NULL AND walk_in_dish_ok(v_dish, v_today),
    'dishes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'category', t.category,
                                          'kcal', t.kcal, 'protein', t.protein) ORDER BY t.category, t.name)
        FROM meal_templates t WHERE walk_in_dish_ok(t.id, v_today)), '[]'::jsonb),
    'drinks', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'category', t.category,
                                          'kcal', t.kcal, 'protein', t.protein) ORDER BY t.category, t.name)
        FROM meal_templates t WHERE walk_in_drink_ok(t.id, v_today)), '[]'::jsonb),
    'addons', v_addons,
    'portions', to_jsonb(v_ports),
    'portion_cost', v_cost,
    'spendable', schedulable_paise(v_user),
    'today', todays_walk_in(v_user))
  -- What the 082 Home card (app 1.10.11 and older) reads, until the update.
  || jsonb_build_object(
    'slot', v_slot,
    'meal_name', (SELECT name FROM meal_templates WHERE id = v_dish),
    'cost', v_cost * v_ports[1],
    'can_afford', schedulable_paise(v_user) >= v_cost * v_ports[1],
    'extra', false,
    'open_walk_in', (SELECT jsonb_build_object('order_id', t->>'order_id', 'code', t->>'code', 'location', t->>'location')
                       FROM (SELECT todays_walk_in(v_user) AS t) x WHERE t IS NOT NULL AND t->>'status' <> 'delivered'));
END; $$;
REVOKE ALL ON FUNCTION public.walk_in_quote(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.walk_in_quote(text) TO authenticated;

-- start_walk_in: p_options gains {"drink": "<meal_templates id>"} — a smoothie or
-- coffee dish, active and not marked unavailable today (walk_in_drink_ok; a
-- coffee is fine here: walk-in is eaten here or taken away). It sets
-- orders.drink_template_id and the drink line's sub_option to the drink's name.
-- Left out ("Chef's choice") the line keeps the legacy behaviour:
-- {"smoothie": "<free text>"} (older app builds) or the plan's own flavour. A
-- "drink" for a plan with no drink add-on is ignored (there is no line to carry
-- it). The meal itself (p_meal, or the plan's default) can't be a drink.
-- Otherwise identical to 087.
CREATE OR REPLACE FUNCTION public.start_walk_in(
  p_location text, p_mode text, p_meal text DEFAULT NULL, p_portions integer DEFAULT NULL, p_options jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user  uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_sub   uuid;
  l       public.pickup_locations;
  v_slot  text;
  v_def   text;
  v_dish  text;
  v_qty   integer;
  v_ports integer[];
  v_cost  integer;
  v_id    uuid;
  v_seq   integer;
  v_today_walk jsonb;
  v_drink      text := NULLIF(btrim(p_options->>'drink'), '');
  v_drink_name text;
  v_has_drink  boolean;
BEGIN
  v_sub := pickup_plan_for(v_user);
  l := check_pickup_place(p_location, p_mode);
  v_slot := pickup_slot_now(p_location);
  IF v_slot IS NULL THEN
    RAISE EXCEPTION '% takes walk-ins from % to %.', l.name,
      to_char(l.opens_at, 'FMHH12:MI AM'), to_char(l.closes_at, 'FMHH12:MI AM');
  END IF;

  -- One a day; a second tap gets the same code back.
  PERFORM 1 FROM subscriptions WHERE id = v_sub FOR UPDATE;
  v_today_walk := todays_walk_in(v_user);
  IF v_today_walk IS NOT NULL THEN
    IF v_today_walk->>'status' = 'delivered' THEN
      RAISE EXCEPTION 'You''ve had today''s walk-in — one a day. See you tomorrow!';
    END IF;
    RETURN v_today_walk || jsonb_build_object('existing', true);
  END IF;

  v_def := walk_in_default_slot(v_sub, v_slot);
  v_dish := COALESCE(NULLIF(p_meal, ''), plan_default_dish(v_user, v_today, v_def));
  IF v_dish IS NULL THEN RAISE EXCEPTION 'Pick a dish for your walk-in.'; END IF;
  IF EXISTS (SELECT 1 FROM meal_templates t WHERE t.id = v_dish AND t.category IN ('smoothie', 'coffee')) THEN
    RAISE EXCEPTION 'A drink can''t be your walk-in meal — pick a dish, then choose your drink.';
  END IF;
  IF NOT walk_in_dish_ok(v_dish, v_today) THEN
    RAISE EXCEPTION '% isn''t served at our café today — it''s for delivery only. Pick another dish.',
      COALESCE((SELECT name FROM meal_templates WHERE id = v_dish), 'That dish');
  END IF;

  v_ports := walk_in_portions(v_sub, v_def);
  v_qty := COALESCE(p_portions, v_ports[1]);
  IF NOT (v_qty = ANY (v_ports)) THEN
    RAISE EXCEPTION '%', CASE WHEN array_length(v_ports, 1) = 1 THEN 'Your walk-in is 2 portions.' ELSE 'Pick 1 or 2 portions.' END;
  END IF;

  -- The plan's add-ons always come with it: the Kitchen's per-day add-on
  -- switch doesn't stop a walk-in (the café sorts out a substitute).

  -- The drink (088): only a plan with a drink add-on has a line to put it on.
  SELECT EXISTS (SELECT 1 FROM subscription_addons sa JOIN addons ad ON ad.id = sa.addon_id
                  WHERE sa.subscription_id = v_sub AND ad.is_drink)
    INTO v_has_drink;
  IF v_drink IS NOT NULL AND v_has_drink THEN
    IF walk_in_drink_ok(v_drink, v_today) THEN
      SELECT t.name INTO v_drink_name FROM meal_templates t WHERE t.id = v_drink;
    END IF;
    IF v_drink_name IS NULL THEN
      RAISE EXCEPTION 'That drink isn''t served at our café today — pick another one, or leave it to the chef.';
    END IF;
  ELSE
    v_drink := NULL;
  END IF;

  v_cost := default_meal_cost(v_sub) * v_qty;
  IF schedulable_paise(v_user) < v_cost THEN
    RAISE EXCEPTION 'Your wallet doesn''t have room for this walk-in — renew your plan to add meals.';
  END IF;

  SELECT COALESCE(max(slot_seq), 0) + 1 INTO v_seq FROM orders
   WHERE subscription_id = v_sub AND delivery_date = v_today AND meal_slot = v_slot;

  INSERT INTO orders (user_id, subscription_id, meal_template_id, delivery_date, meal_slot, status,
                      quantity, unit_price, extra_dish, slot_seq, is_customized, cart_edited,
                      fulfilment, pickup_location_id, walk_in, drink_template_id)
  VALUES (v_user, v_sub, v_dish, v_today, v_slot, 'confirmed',
          v_qty, default_meal_cost(v_sub), false, v_seq, true, true,
          p_mode, l.id, true, v_drink)
  RETURNING id INTO v_id;

  PERFORM snapshot_order_ingredients(v_id);
  INSERT INTO order_addons (order_id, addon_id, sub_option)
  SELECT v_id, sa.addon_id,
         CASE WHEN ad.is_drink AND v_drink IS NOT NULL
              THEN v_drink_name
              ELSE COALESCE(NULLIF(left(p_options->>sa.addon_id, 60), ''), sa.sub_option) END
    FROM subscription_addons sa JOIN addons ad ON ad.id = sa.addon_id
   WHERE sa.subscription_id = v_sub;
  PERFORM recompute_order_cart(v_id);

  RETURN todays_walk_in(v_user) || jsonb_build_object('existing', false);
END; $$;
REVOKE ALL ON FUNCTION public.start_walk_in(text, text, text, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_walk_in(text, text, text, integer, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
