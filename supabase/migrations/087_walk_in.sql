-- ============================================================
-- GreenFeast — Migration 087: walk-in replaces booked pickup / dine-in
-- ============================================================
-- 082's pickup and dine-in, rebuilt from the bottom up:
--
--   Delivery   every planned meal is delivered. Booking a delivery day for
--              collection (set_order_fulfilment, set_my_collection) is gone;
--              plans' collection defaults go back to delivery.
--   Walk-in    My Plan → Walk-in: a 30- or 60-meal subscriber (plans.allow_pickup)
--              picks a place, eat-here or takeaway, and orders their default
--              meal — any time the place is open (11 AM–11 PM), any day,
--              Sunday too. One a day. It has nothing to do with that day's
--              delivery: both are charged; cancelling a delivery is up to them.
--                * structure fixed: the plan's add-ons, as set at sign-up;
--                * the dish is theirs to choose (their default for today comes
--                  first) — any dish shown on the café menu (menu_visible),
--                  unless the kitchen marked it unavailable today. A
--                  delivery-only dish (menu_visible off) can't be a walk-in;
--                * flavours (smoothie, cheese) are theirs to choose; the
--                  Kitchen's per-day add-on switch doesn't block a walk-in;
--                * portions: the default (capped at 2) or one more, 1–2.
--              walk_in_quote(place) shows all that; start_walk_in(...) makes
--              it and returns the 6-digit code. Paid from the wallet when the
--              Counter hands it over (redeem_pickup, unchanged); a code not
--              used by closing time is cancelled, uncharged.
--   Plan & settings  portions, delivery days and dishes only: lunch / dinner
--              stay as chosen at sign-up (an on slot can't go below 1, an off
--              slot can't be turned on), and add-ons can't be added or removed.
--
-- The 082 columns stay (old orders keep their history); new non-delivery
-- orders can only be walk-ins.

-- ── Booked collection: gone ─────────────────────────────────────────────────
UPDATE public.subscriptions
   SET fulfilment_lunch = 'delivery', fulfilment_dinner = 'delivery',
       pickup_location_lunch = NULL, pickup_location_dinner = NULL, updated_at = now()
 WHERE fulfilment_lunch <> 'delivery' OR fulfilment_dinner <> 'delivery'
    OR pickup_location_lunch IS NOT NULL OR pickup_location_dinner IS NOT NULL;

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_collection_check;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_collection_check CHECK (
  fulfilment_lunch = 'delivery' AND fulfilment_dinner = 'delivery'
  AND pickup_location_lunch IS NULL AND pickup_location_dinner IS NULL
);

-- Booked meals still to come go back on delivery (their batch comes back
-- through orders_batch_from_address, the code is cleared by orders_pickup_fields).
UPDATE public.orders
   SET fulfilment = 'delivery', pickup_location_id = NULL, updated_at = now()
 WHERE fulfilment <> 'delivery' AND NOT walk_in
   AND status IN ('scheduled', 'confirmed');

-- From now on only a walk-in is collected (old booked rows are left as history).
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_collect_walk_in_only;
ALTER TABLE public.orders ADD CONSTRAINT orders_collect_walk_in_only
  CHECK (fulfilment = 'delivery' OR walk_in) NOT VALID;

-- Older app versions still call these: a clear message instead of a booking.
CREATE OR REPLACE FUNCTION public.set_order_fulfilment(p_order uuid, p_mode text, p_location text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Collecting a planned meal has moved to My Plan → Walk-in. Please update the app.';
END; $$;

CREATE OR REPLACE FUNCTION public.set_my_collection(p_slot text, p_mode text, p_location text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Your meals are delivered. To eat at our café, use My Plan → Walk-in. Please update the app.';
END; $$;

DROP FUNCTION IF EXISTS public.reset_to_default_meal(uuid);

-- ── A walk-in never blocks a delivery slot ──────────────────────────────────
-- The (subscription, date, slot, seq) key is for planned meals; a walk-in sits
-- beside them.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_subscription_delivery_slot_seq_unique;
CREATE UNIQUE INDEX IF NOT EXISTS orders_subscription_delivery_slot_seq_uniq
  ON public.orders (subscription_id, delivery_date, meal_slot, slot_seq)
  WHERE NOT walk_in;
CREATE INDEX IF NOT EXISTS idx_orders_walk_in_day ON public.orders (user_id, delivery_date) WHERE walk_in;

-- Default changes never touch a walk-in (080's re-sync, plus NOT walk_in).
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
    SELECT o.id, sa.addon_id, sa.sub_option FROM subscription_addons sa WHERE sa.subscription_id = p_sub;

    PERFORM recompute_order_cart(o.id);
    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object('updated', v_updated, 'dish_changed', v_moved, 'cancelled', v_off);
END; $$;
REVOKE ALL ON FUNCTION public.resync_plan_orders(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resync_plan_orders(uuid) TO service_role;

-- ── Plan & settings: portions, days, dishes ─────────────────────────────────
-- p_addons is kept for older app versions: the same add-ons (a flavour may
-- change) or nothing; adding or removing one is refused.
CREATE OR REPLACE FUNCTION public.set_my_plan_defaults(
  p_sub uuid, p_meals_lunch integer, p_meals_dinner integer, p_days text[], p_addons jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sub     uuid := my_live_plan(p_sub);
  s         record;
  v_days    text[];
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

  SELECT array_agg(DISTINCT d) INTO v_days FROM unnest(COALESCE(p_days, '{}')) d;
  IF v_days IS NULL OR array_length(v_days, 1) IS NULL THEN
    RAISE EXCEPTION 'Pick at least one delivery day.';
  END IF;
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
    'meals_left', (SELECT deliveries_remaining FROM subscriptions WHERE id = v_sub));
END; $$;
REVOKE ALL ON FUNCTION public.set_my_plan_defaults(uuid, integer, integer, text[], jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_plan_defaults(uuid, integer, integer, text[], jsonb) TO authenticated;

-- ── Walk-in ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pickup_plan_for(p_user uuid)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sub   uuid;
  v_allow boolean;
BEGIN
  SELECT s.id, p.allow_pickup INTO v_sub, v_allow
    FROM subscriptions s JOIN plans p ON p.id = s.plan_id
   WHERE s.user_id = p_user AND s.status IN ('active', 'paused')
   ORDER BY s.created_at DESC LIMIT 1;
  IF v_sub IS NULL THEN RAISE EXCEPTION 'You need a live plan for this.'; END IF;
  IF NOT COALESCE(v_allow, false) THEN
    RAISE EXCEPTION 'Walk-in comes with the 30- and 60-meal plans.';
  END IF;
  RETURN v_sub;
END; $$;
REVOKE ALL ON FUNCTION public.pickup_plan_for(uuid) FROM PUBLIC, anon, authenticated;

-- A dish a walk-in can be: shown on the café menu and not off today.
CREATE OR REPLACE FUNCTION public.walk_in_dish_ok(p_meal text, p_date date)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM meal_templates t
     WHERE t.id = p_meal AND t.is_active AND t.menu_visible
       AND NOT EXISTS (SELECT 1 FROM meal_availability a
                        WHERE a.for_date = p_date AND a.meal_template_id = t.id AND NOT a.is_available))
$$;
REVOKE ALL ON FUNCTION public.walk_in_dish_ok(text, date) FROM PUBLIC, anon, authenticated;

-- Which slot's defaults a walk-in starts from: the one running now if the
-- plan has it, else the plan's other one.
CREATE OR REPLACE FUNCTION public.walk_in_default_slot(p_sub uuid, p_slot text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN p_slot = 'lunch'  AND COALESCE(s.meals_lunch, 0)  > 0 THEN 'lunch'
    WHEN p_slot = 'dinner' AND COALESCE(s.meals_dinner, 0) > 0 THEN 'dinner'
    WHEN COALESCE(s.meals_lunch, 0) > 0 THEN 'lunch'
    ELSE 'dinner' END
  FROM subscriptions s WHERE s.id = p_sub
$$;
REVOKE ALL ON FUNCTION public.walk_in_default_slot(uuid, text) FROM PUBLIC, anon, authenticated;

-- Default portions capped at 2 → the choices: that, or one more (max 2).
CREATE OR REPLACE FUNCTION public.walk_in_portions(p_sub uuid, p_slot text)
RETURNS integer[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN d >= 2 THEN ARRAY[2] ELSE ARRAY[1, 2] END
    FROM (SELECT GREATEST(LEAST(CASE p_slot WHEN 'lunch' THEN COALESCE(meals_lunch, 0) ELSE COALESCE(meals_dinner, 0) END, 2), 1) AS d
            FROM subscriptions WHERE id = p_sub) x
$$;
REVOKE ALL ON FUNCTION public.walk_in_portions(uuid, text) FROM PUBLIC, anon, authenticated;

-- Today's walk-in (one a day), if any.
CREATE OR REPLACE FUNCTION public.todays_walk_in(p_user uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
           'order_id', o.id, 'code', o.pickup_code, 'location', o.pickup_location_id,
           'place', l.name, 'mode', o.fulfilment, 'status', o.status,
           'meal_name', t.name, 'portions', o.quantity, 'cost', o.cart_total,
           'collected_at', o.collected_at,
           'closes', to_char(l.closes_at, 'FMHH12:MI AM'),
           'addons', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', ad.name, 'sub_option', oa.sub_option) ORDER BY ad.name)
                                 FROM order_addons oa JOIN addons ad ON ad.id = oa.addon_id
                                WHERE oa.order_id = o.id AND oa.kind = 'addon'), '[]'::jsonb))
    FROM orders o
    JOIN pickup_locations l ON l.id = o.pickup_location_id
    LEFT JOIN meal_templates t ON t.id = o.meal_template_id
   WHERE o.user_id = p_user AND o.walk_in
     AND o.delivery_date = (now() AT TIME ZONE 'Asia/Kolkata')::date
     AND o.status NOT IN ('cancelled', 'skipped')
   ORDER BY o.created_at DESC
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.todays_walk_in(uuid) FROM PUBLIC, anon, authenticated;

-- The Walk-in screen's first look: may this customer walk in, and today's one.
CREATE OR REPLACE FUNCTION public.my_walk_in_today()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    PERFORM pickup_plan_for(auth.uid());
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('eligible', false, 'error', SQLERRM);
  END;
  RETURN jsonb_build_object('eligible', true, 'today', todays_walk_in(auth.uid()));
END; $$;
REVOKE ALL ON FUNCTION public.my_walk_in_today() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_walk_in_today() TO authenticated;

-- Everything the Walk-in screen shows for a place, before ordering.
DROP FUNCTION IF EXISTS public.walk_in_quote(text);
CREATE OR REPLACE FUNCTION public.walk_in_quote(p_location text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
           'id', ad.id, 'name', ad.name, 'sub_option', sa.sub_option)
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

-- Makes today's walk-in. p_options: {"smoothie": "Creamy Avocado"} — a flavour
-- per add-on (the plan's own when left out). Called with just place and mode
-- (older app versions) it's the default dish and portions.
DROP FUNCTION IF EXISTS public.start_walk_in(text, text);
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

  v_cost := default_meal_cost(v_sub) * v_qty;
  IF schedulable_paise(v_user) < v_cost THEN
    RAISE EXCEPTION 'Your wallet doesn''t have room for this walk-in — renew your plan to add meals.';
  END IF;

  SELECT COALESCE(max(slot_seq), 0) + 1 INTO v_seq FROM orders
   WHERE subscription_id = v_sub AND delivery_date = v_today AND meal_slot = v_slot;

  INSERT INTO orders (user_id, subscription_id, meal_template_id, delivery_date, meal_slot, status,
                      quantity, unit_price, extra_dish, slot_seq, is_customized, cart_edited,
                      fulfilment, pickup_location_id, walk_in)
  VALUES (v_user, v_sub, v_dish, v_today, v_slot, 'confirmed',
          v_qty, default_meal_cost(v_sub), false, v_seq, true, true,
          p_mode, l.id, true)
  RETURNING id INTO v_id;

  PERFORM snapshot_order_ingredients(v_id);
  INSERT INTO order_addons (order_id, addon_id, sub_option)
  SELECT v_id, sa.addon_id,
         COALESCE(NULLIF(left(p_options->>sa.addon_id, 60), ''), sa.sub_option)
    FROM subscription_addons sa WHERE sa.subscription_id = v_sub;
  PERFORM recompute_order_cart(v_id);

  RETURN todays_walk_in(v_user) || jsonb_build_object('existing', false);
END; $$;
REVOKE ALL ON FUNCTION public.start_walk_in(text, text, text, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_walk_in(text, text, text, integer, jsonb) TO authenticated;

-- ── Closing time ────────────────────────────────────────────────────────────
-- A walk-in's code works until the place closes, whatever the slot.
CREATE OR REPLACE FUNCTION public.settle_pickups()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_now   time := (now() AT TIME ZONE 'Asia/Kolkata')::time;
  o       record;
  res     jsonb;
  v_billed integer := 0;
  v_expired integer := 0;
BEGIN
  FOR o IN
    SELECT x.id, x.user_id, x.walk_in, x.meal_slot, x.delivery_date, l.name AS place
      FROM orders x JOIN pickup_locations l ON l.id = x.pickup_location_id
     WHERE x.fulfilment <> 'delivery'
       AND x.status IN ('scheduled', 'confirmed', 'preparing')
       AND (x.delivery_date < v_today
            OR (x.delivery_date = v_today
                AND v_now >= CASE WHEN x.walk_in OR x.meal_slot = 'dinner' THEN l.closes_at ELSE l.lunch_until END))
     ORDER BY x.delivery_date, x.meal_slot
  LOOP
    IF o.walk_in THEN
      UPDATE orders SET status = 'cancelled', skip_reason = 'walk_in_expired', updated_at = now() WHERE id = o.id;
      v_expired := v_expired + 1;
    ELSE
      -- Booked before 087, never collected: charged like a delivery.
      res := advance_order_delivered(o.id);
      IF res->>'result' = 'billed' THEN
        UPDATE orders SET pickup_missed = true WHERE id = o.id;
        PERFORM notify_event(o.user_id, 'pickup_missed', jsonb_build_object(
          'slot', o.meal_slot, 'place', o.place, 'date', to_char(o.delivery_date, 'Dy FMDD Mon')));
        v_billed := v_billed + 1;
      END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('missed_billed', v_billed, 'walk_ins_expired', v_expired);
END; $$;
REVOKE ALL ON FUNCTION public.settle_pickups() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_pickups() TO service_role;

UPDATE public.notification_templates SET enabled = false WHERE key = 'pickup_missed';

NOTIFY pgrst, 'reload schema';
