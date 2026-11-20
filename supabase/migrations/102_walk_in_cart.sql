-- 102: Walk-in is a cart (2026-11-20).
--
-- A walk-in used to be the plan's default meal in 1–2 portions. Now it's a
-- cart like the delivery cart (097): meals (any dish the café serves today ×
-- qty, each with its own add-ons) and drinks (smoothie / coffee × qty), priced
-- the same way — meal = plan meal rate + premium, drink = drink_price(), each
-- add-on its price — and paid from the wallet when the counter hands it over.
--
-- Limits, from the plan's default for the meal it is (walk_in_default_slot:
-- lunch until the place's lunch_until, else dinner; the other slot if the plan
-- has none), M meals and D drinks:
--   meals   1 … M + 1
--   drinks  (1 if D > 0, else 0) … D + 1
--   the plan's add-ons on as many meals as they take, up to M
-- Everything else is free: any dish, swaps, premium dishes, extra add-ons.
--
-- One code covers the whole cart: every item is an orders row (walk_in, same
-- pickup_code). The counter's redeem_pickup hands over and bills all of them
-- at once — or none, when the wallet doesn't cover the lot. One walk-in a day,
-- as before. start_walk_in (088) stays for app versions before this one.

-- ── Limits ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.walk_in_limits(p_sub uuid, p_slot text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_def text := walk_in_default_slot(p_sub, p_slot);
  m     integer := GREATEST(plan_slot_meals(p_sub, v_def), 1);
  d     integer := COALESCE(plan_slot_drinks(p_sub, v_def), 0);
BEGIN
  RETURN jsonb_build_object(
    'slot', v_def,
    'default_meals', m,
    'default_drinks', d,
    'meal_min', 1,
    'meal_max', m + 1,
    'drink_min', CASE WHEN d > 0 THEN 1 ELSE 0 END,
    'drink_max', d + 1,
    'plan_addon_ids', COALESCE((
      SELECT jsonb_agg(sa.addon_id ORDER BY sa.addon_id)
        FROM subscription_addons sa JOIN addons a ON a.id = sa.addon_id
       WHERE sa.subscription_id = p_sub AND NOT a.is_drink), '[]'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.walk_in_limits(uuid, text) FROM PUBLIC, anon, authenticated;

-- ── Today's walk-in: the whole cart ─────────────────────────────────────────
-- Same fields as before (order_id = the cart's first item, meal_name, portions
-- = meals, cost = the cart's total, addons = all its add-ons) plus items.
CREATE OR REPLACE FUNCTION public.todays_walk_in(p_user uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH head AS (
    SELECT o.* FROM orders o
     WHERE o.user_id = p_user AND o.walk_in
       AND o.delivery_date = (now() AT TIME ZONE 'Asia/Kolkata')::date
       AND o.status NOT IN ('cancelled', 'skipped')
     ORDER BY o.created_at DESC, o.slot_seq
     LIMIT 1
  ), cart AS (
    SELECT o.* FROM orders o, head h
     WHERE o.user_id = h.user_id AND o.walk_in AND o.delivery_date = h.delivery_date
       AND o.pickup_code IS NOT DISTINCT FROM h.pickup_code
       AND o.status NOT IN ('cancelled', 'skipped')
  )
  SELECT jsonb_build_object(
           'order_id', (SELECT c.id FROM cart c ORDER BY (c.item_kind = 'drink'), c.slot_seq, c.created_at LIMIT 1),
           'code', h.pickup_code, 'location', h.pickup_location_id,
           'place', l.name, 'mode', h.fulfilment, 'status', h.status,
           'meal_name', (SELECT t.name FROM cart c JOIN meal_templates t ON t.id = c.meal_template_id
                          WHERE COALESCE(c.item_kind, 'meal') = 'meal' ORDER BY c.slot_seq LIMIT 1),
           'portions', COALESCE((SELECT sum(c.quantity) FROM cart c WHERE COALESCE(c.item_kind, 'meal') = 'meal'), 0),
           'cost', (SELECT sum(COALESCE(c.cart_total, 0)) FROM cart c),
           'collected_at', h.collected_at,
           'closes', to_char(l.closes_at, 'FMHH12:MI AM'),
           'addons', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', ad.name, 'sub_option', oa.sub_option) ORDER BY ad.name)
                                 FROM cart c JOIN order_addons oa ON oa.order_id = c.id JOIN addons ad ON ad.id = oa.addon_id
                                WHERE oa.kind = 'addon'), '[]'::jsonb),
           'items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                'kind', COALESCE(c.item_kind, 'meal'), 'name', t.name, 'qty', c.quantity,
                                'addons', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', ad.name, 'qty', oa.quantity) ORDER BY ad.name)
                                                      FROM order_addons oa JOIN addons ad ON ad.id = oa.addon_id
                                                     WHERE oa.order_id = c.id AND oa.kind = 'addon' AND NOT ad.is_drink), '[]'::jsonb))
                              ORDER BY (c.item_kind = 'drink'), c.slot_seq)
                                FROM cart c LEFT JOIN meal_templates t ON t.id = c.meal_template_id), '[]'::jsonb))
    FROM head h JOIN pickup_locations l ON l.id = h.pickup_location_id
$$;
REVOKE ALL ON FUNCTION public.todays_walk_in(uuid) FROM PUBLIC, anon, authenticated;

-- ── What the cart screen needs ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.walk_in_cart_quote(p_location text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user  uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_sub   uuid;
  l       public.pickup_locations;
  v_slot  text;
  lim     jsonb;
  v_dish  text;
  v_drink text;
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
  lim := walk_in_limits(v_sub, v_slot);
  v_dish := plan_default_dish(v_user, v_today, lim->>'slot');
  IF v_dish IS NULL OR is_drink_dish(v_dish) OR NOT walk_in_dish_ok(v_dish, v_today) THEN v_dish := NULL; END IF;
  v_drink := slot_default_drink(v_today, lim->>'slot');
  IF v_drink IS NULL OR NOT walk_in_drink_ok(v_drink, v_today) THEN v_drink := NULL; END IF;

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
    'limits', lim,
    'meal_price', subscription_meal_rate(v_sub),
    'drink_price', drink_price(),
    'default_meal_id', v_dish,
    'default_drink_id', v_drink,
    'dishes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'category', t.category, 'kcal', t.kcal,
                                          'short_description', t.short_description, 'image_url', t.image_url,
                                          'thumb_url', t.thumb_url, 'premium_paise', COALESCE(t.premium_paise, 0))
                       ORDER BY t.category, t.name)
        FROM meal_templates t
       WHERE (NOT is_drink_dish(t.id) AND walk_in_dish_ok(t.id, v_today))
          OR (is_drink_dish(t.id) AND walk_in_drink_ok(t.id, v_today))), '[]'::jsonb),
    'addons', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'price_per_meal', a.price_per_meal) ORDER BY a.name)
        FROM addons a WHERE a.is_active AND NOT a.is_drink), '[]'::jsonb),
    'spendable', schedulable_paise(v_user),
    'today', todays_walk_in(v_user));
END; $$;
REVOKE ALL ON FUNCTION public.walk_in_cart_quote(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.walk_in_cart_quote(text) TO authenticated;

-- ── Start a walk-in from a cart ─────────────────────────────────────────────
-- p_items: [{"kind":"meal","dish":"<id>","qty":1,"addons":[{"id":"seeds","qty":1}]},
--           {"kind":"drink","dish":"<id>","qty":1}]
CREATE OR REPLACE FUNCTION public.start_walk_in_cart(p_location text, p_mode text, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_today  date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_sub    uuid;
  l        public.pickup_locations;
  v_slot   text;
  lim      jsonb;
  v_walk   jsonb;
  it       jsonb;
  x        jsonb;
  v_kind   text;
  v_dish   text;
  v_qty    integer;
  v_aqty   integer;
  v_meals  integer := 0;
  v_drinks integer := 0;
  v_cost   integer := 0;
  v_need   integer;
  v_pid    text;
  v_have   integer;
  v_seq    integer;
  v_id     uuid;
  v_code   text;
  v_first  boolean := true;
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
  v_walk := todays_walk_in(v_user);
  IF v_walk IS NOT NULL THEN
    IF v_walk->>'status' = 'delivered' THEN
      RAISE EXCEPTION 'You''ve had today''s walk-in — one a day. See you tomorrow!';
    END IF;
    RETURN v_walk || jsonb_build_object('existing', true);
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Add a meal to your walk-in.';
  END IF;
  lim := walk_in_limits(v_sub, v_slot);

  -- Check every item, count, and price it.
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_kind := COALESCE(it->>'kind', 'meal');
    v_dish := it->>'dish';
    v_qty  := COALESCE((it->>'qty')::int, 1);
    IF v_kind NOT IN ('meal', 'drink') THEN RAISE EXCEPTION 'Unknown item.'; END IF;
    IF v_qty < 1 OR v_qty > 10 THEN RAISE EXCEPTION 'Between 1 and 10 of each item.'; END IF;
    IF v_kind = 'meal' THEN
      IF v_dish IS NULL OR is_drink_dish(v_dish) THEN
        RAISE EXCEPTION 'A drink goes in the drinks — pick a dish for your meal.';
      END IF;
      IF NOT walk_in_dish_ok(v_dish, v_today) THEN
        RAISE EXCEPTION '% isn''t served at our café today — pick another dish.',
          COALESCE((SELECT name FROM meal_templates WHERE id = v_dish), 'That dish');
      END IF;
      v_meals := v_meals + v_qty;
      FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(it->'addons', '[]'::jsonb)) LOOP
        v_aqty := COALESCE((x->>'qty')::int, 1);
        IF NOT EXISTS (SELECT 1 FROM addons WHERE id = x->>'id' AND is_active AND NOT is_drink) THEN
          RAISE EXCEPTION 'That add-on isn''t available.';
        END IF;
        IF v_aqty < 0 OR v_aqty > 10 THEN RAISE EXCEPTION 'Between 0 and 10 of each add-on.'; END IF;
        v_cost := v_cost + v_aqty * (SELECT price_per_meal FROM addons WHERE id = x->>'id');
      END LOOP;
    ELSE
      IF v_dish IS NULL OR NOT is_drink_dish(v_dish) OR NOT walk_in_drink_ok(v_dish, v_today) THEN
        RAISE EXCEPTION 'That drink isn''t served at our café today — pick another one.';
      END IF;
      v_drinks := v_drinks + v_qty;
    END IF;
    v_cost := v_cost + v_qty * item_unit_price(v_sub, v_dish);
  END LOOP;

  IF v_meals < (lim->>'meal_min')::int THEN RAISE EXCEPTION 'Add a meal to your walk-in.'; END IF;
  IF v_meals > (lim->>'meal_max')::int THEN
    RAISE EXCEPTION 'Up to % meals at a walk-in.', lim->>'meal_max';
  END IF;
  IF v_drinks < (lim->>'drink_min')::int THEN RAISE EXCEPTION 'Your plan comes with a drink — add one.'; END IF;
  IF v_drinks > (lim->>'drink_max')::int THEN
    RAISE EXCEPTION 'Up to % drink% at a walk-in.', lim->>'drink_max', CASE WHEN (lim->>'drink_max')::int = 1 THEN '' ELSE 's' END;
  END IF;

  -- The plan's add-ons go on as many meals as they take, up to their default.
  v_need := LEAST(v_meals, (lim->>'default_meals')::int);
  FOR v_pid IN SELECT jsonb_array_elements_text(lim->'plan_addon_ids') LOOP
    SELECT COALESCE(sum(COALESCE((ax.v->>'qty')::int, 1)), 0) INTO v_have
      FROM jsonb_array_elements(p_items) e, jsonb_array_elements(COALESCE(e->'addons', '[]'::jsonb)) AS ax(v)
     WHERE COALESCE(e->>'kind', 'meal') = 'meal' AND ax.v->>'id' = v_pid;
    IF v_have < v_need THEN
      RAISE EXCEPTION '% comes with your plan — keep it on % meal%.',
        (SELECT name FROM addons WHERE id = v_pid), v_need, CASE WHEN v_need = 1 THEN '' ELSE 's' END;
    END IF;
  END LOOP;

  IF schedulable_paise(v_user) < v_cost THEN
    RAISE EXCEPTION 'Your wallet doesn''t cover this walk-in (%) — take less, or renew your plan.', fmt_rupees(v_cost);
  END IF;

  -- Write the cart: meals first, then drinks; one code for all of it.
  SELECT COALESCE(max(slot_seq), 0) INTO v_seq FROM orders
   WHERE subscription_id = v_sub AND delivery_date = v_today AND meal_slot = v_slot AND walk_in;

  FOR it IN
    SELECT e FROM jsonb_array_elements(p_items) e ORDER BY (COALESCE(e->>'kind', 'meal') = 'drink')
  LOOP
    v_kind := COALESCE(it->>'kind', 'meal');
    v_dish := it->>'dish';
    v_qty  := COALESCE((it->>'qty')::int, 1);
    v_seq  := v_seq + 1;
    INSERT INTO orders (user_id, subscription_id, meal_template_id, delivery_date, meal_slot, status,
                        quantity, unit_price, item_kind, extra_dish, slot_seq, is_customized, cart_edited,
                        fulfilment, pickup_location_id, walk_in, pickup_code)
    VALUES (v_user, v_sub, v_dish, v_today, v_slot, 'confirmed',
            v_qty, item_unit_price(v_sub, v_dish), v_kind, NOT v_first, v_seq, true, true,
            p_mode, l.id, true, v_code)
    RETURNING id, pickup_code INTO v_id, v_code;
    v_first := false;
    PERFORM snapshot_order_ingredients(v_id);
    IF v_kind = 'meal' THEN
      INSERT INTO order_addons (order_id, addon_id, sub_option, quantity, unit_price, is_plan)
      SELECT v_id, a.id, NULLIF(ax.v->>'option', ''), COALESCE((ax.v->>'qty')::int, 1), a.price_per_meal,
             EXISTS (SELECT 1 FROM subscription_addons sa WHERE sa.subscription_id = v_sub AND sa.addon_id = a.id)
        FROM jsonb_array_elements(COALESCE(it->'addons', '[]'::jsonb)) AS ax(v)
        JOIN addons a ON a.id = ax.v->>'id'
       WHERE COALESCE((ax.v->>'qty')::int, 1) > 0;
    END IF;
    PERFORM recompute_order_cart(v_id);
  END LOOP;

  RETURN todays_walk_in(v_user) || jsonb_build_object('existing', false);
END; $$;
REVOKE ALL ON FUNCTION public.start_walk_in_cart(text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_walk_in_cart(text, text, jsonb) TO authenticated;

-- ── The counter hands over the whole cart ───────────────────────────────────
-- Every open item with that code (a pre-102 walk-in or a booked pickup is a
-- cart of one). The wallet must cover the lot: if it doesn't, the whole cart is
-- skipped for the wallet, as advance_order_delivered does for a delivery.
CREATE OR REPLACE FUNCTION public.redeem_pickup(p_order uuid, p_location text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o       record;
  r       record;
  res     jsonb;
  v_ids   uuid[];
  v_total integer := 0;
  v_bal   integer;
  v_cod   boolean;
  v_billed integer := 0;
BEGIN
  SELECT id, user_id, subscription_id, fulfilment, pickup_location_id, delivery_date, status, walk_in, pickup_code
    INTO o FROM orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND OR o.fulfilment = 'delivery' THEN RAISE EXCEPTION 'That isn''t a pickup.'; END IF;
  IF o.pickup_location_id IS DISTINCT FROM p_location THEN RAISE EXCEPTION 'That meal is booked at another place.'; END IF;
  IF o.delivery_date <> (now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'That code is for another day.'; END IF;
  IF o.status IN ('delivered') THEN RAISE EXCEPTION 'Already handed over.'; END IF;
  IF o.status IN ('cancelled', 'skipped') THEN RAISE EXCEPTION 'That meal was cancelled.'; END IF;

  SELECT array_agg(x.id ORDER BY x.slot_seq) INTO v_ids
    FROM orders x
   WHERE x.user_id = o.user_id AND x.delivery_date = o.delivery_date
     AND x.pickup_location_id = o.pickup_location_id AND x.fulfilment <> 'delivery'
     AND x.pickup_code IS NOT DISTINCT FROM o.pickup_code
     AND x.status IN ('scheduled', 'confirmed', 'preparing', 'out_for_delivery')
     AND (x.id = o.id OR o.pickup_code IS NOT NULL);

  FOR r IN SELECT unnest(v_ids) AS id LOOP
    v_total := v_total + recompute_order_cart(r.id);
  END LOOP;

  SELECT (s.status = 'pending' AND s.payment_method = 'cod') INTO v_cod FROM subscriptions s WHERE s.id = o.subscription_id;
  SELECT COALESCE(balance, 0) INTO v_bal FROM wallets WHERE user_id = o.user_id FOR UPDATE;
  IF v_total > 0 AND COALESCE(v_bal, 0) < v_total AND NOT COALESCE(v_cod, false) THEN
    UPDATE orders SET status = 'skipped', skip_reason = 'insufficient_balance', updated_at = now() WHERE id = ANY (v_ids);
    INSERT INTO notifications (user_id, title, body, type) VALUES (
      o.user_id, 'Walk-in not handed over',
      'Your wallet didn''t cover today''s walk-in. Renew your plan in the app to keep going.', 'order_update');
    RETURN jsonb_build_object('result', 'skipped_insufficient');
  END IF;

  FOR r IN SELECT unnest(v_ids) AS id LOOP
    res := advance_order_delivered(r.id);
    IF res->>'result' = 'billed' THEN
      UPDATE orders SET collected_at = now() WHERE id = r.id;
      v_billed := v_billed + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('result', CASE WHEN v_billed > 0 THEN 'billed' ELSE 'already_settled' END,
                            'items', v_billed, 'total', v_total);
END; $$;

NOTIFY pgrst, 'reload schema';
