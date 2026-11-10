-- ============================================================
-- GreenFeast — Migration 082: pickup and dine-in
-- ============================================================
-- Customers on plans with plans.allow_pickup (30 and 60 meals) can collect a
-- meal instead of having it delivered, at a pickup_locations place:
--   * C-Scheme QSR — takeaway and dine-in; it cooks its own (cooks_own);
--   * Jawahar Nagar kitchen — takeaway only.
-- Always their default meal (080's defaults), never customised.
--
--   Booked ahead   set_order_fulfilment(order, mode, place) before the slot's
--                  cutoff, or set_my_collection(slot, mode, place) as the
--                  plan's default (instantiate-orders and the re-sync use it).
--   Walk-in        walk_in_quote / start_walk_in(place, mode): a default meal
--                  for the slot running now (lunch until lunch_until, dinner
--                  after). Walk-ins come after the cutoff, so with a delivery
--                  already coming it is an extra meal, charged.
--   Counter        the admin's Counter page looks the 6-digit pickup_code up
--                  and hands over: redeem_pickup() bills it like a delivery.
--   Closing        settle_pickups() (every 15 min): once a place's window has
--                  ended, booked pickups nobody collected are billed
--                  (pickup_missed, message pickup_missed) and unused walk-in
--                  codes are cancelled, uncharged ('walk_in_expired').
--
-- A pickup has no delivery batch, so it's on no rider's route and not in the
-- partner app (which works by batch): the batch trigger, the address-moved
-- trigger and the nightly batch sync now only touch deliveries.

-- ── Places ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pickup_locations (
  id             text PRIMARY KEY,
  name           text NOT NULL,
  address        text NOT NULL,
  maps_url       text,
  offers_pickup  boolean NOT NULL DEFAULT true,
  offers_dine_in boolean NOT NULL DEFAULT false,
  cooks_own      boolean NOT NULL DEFAULT false,
  opens_at       time NOT NULL DEFAULT '11:00',
  lunch_until    time NOT NULL DEFAULT '16:00',
  closes_at      time NOT NULL DEFAULT '23:00',
  is_active      boolean NOT NULL DEFAULT true,
  sort_order     integer NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (opens_at < lunch_until AND lunch_until < closes_at),
  CHECK (offers_pickup OR offers_dine_in)
);
ALTER TABLE public.pickup_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pickup_locations_read ON public.pickup_locations;
CREATE POLICY pickup_locations_read ON public.pickup_locations FOR SELECT USING (true);
REVOKE ALL ON public.pickup_locations FROM anon, authenticated;
GRANT SELECT ON public.pickup_locations TO anon, authenticated;
GRANT ALL ON public.pickup_locations TO service_role;

INSERT INTO public.pickup_locations (id, name, address, offers_pickup, offers_dine_in, cooks_own, sort_order)
VALUES
  ('c-scheme', 'GreenFeast QSR, C-Scheme', 'C-Scheme, Jaipur', true, true, true, 1),
  ('jawahar-nagar', 'GreenFeast Kitchen, Jawahar Nagar', 'Jawahar Nagar, Jaipur', true, false, false, 2)
ON CONFLICT (id) DO NOTHING;

-- ── Which plans may collect ─────────────────────────────────────────────────
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS allow_pickup boolean NOT NULL DEFAULT false;
UPDATE public.plans SET allow_pickup = true WHERE id IN ('plan30', 'plan60');

-- ── Orders and plan defaults ────────────────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS fulfilment text NOT NULL DEFAULT 'delivery',
  ADD COLUMN IF NOT EXISTS pickup_location_id text REFERENCES public.pickup_locations(id),
  ADD COLUMN IF NOT EXISTS pickup_code text,
  ADD COLUMN IF NOT EXISTS walk_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS collected_at timestamptz,
  ADD COLUMN IF NOT EXISTS pickup_missed boolean NOT NULL DEFAULT false;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_fulfilment_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_fulfilment_check CHECK (
  fulfilment IN ('delivery', 'pickup', 'dine_in')
  AND (fulfilment = 'delivery') = (pickup_location_id IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_orders_pickup ON public.orders (delivery_date, pickup_location_id)
  WHERE fulfilment <> 'delivery';

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS fulfilment_lunch text NOT NULL DEFAULT 'delivery',
  ADD COLUMN IF NOT EXISTS fulfilment_dinner text NOT NULL DEFAULT 'delivery',
  ADD COLUMN IF NOT EXISTS pickup_location_lunch text REFERENCES public.pickup_locations(id),
  ADD COLUMN IF NOT EXISTS pickup_location_dinner text REFERENCES public.pickup_locations(id);
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_collection_check;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_collection_check CHECK (
  fulfilment_lunch IN ('delivery', 'pickup', 'dine_in') AND fulfilment_dinner IN ('delivery', 'pickup', 'dine_in')
  AND (fulfilment_lunch = 'delivery') = (pickup_location_lunch IS NULL)
  AND (fulfilment_dinner = 'delivery') = (pickup_location_dinner IS NULL)
);

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_skip_reason_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_skip_reason_check CHECK (
  skip_reason = ANY (ARRAY['user', 'insufficient_balance', 'pause', 'admin', 'plan_finished',
                           'kitchen_closed', 'not_delivered', 'off_day', 'walk_in_expired'])
);

-- A customer's own pending plan starts as delivery (069's guard, plus 082).
CREATE OR REPLACE FUNCTION public.guard_customer_subscription_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;
  NEW.status := 'pending';
  NEW.deliveries_remaining := 0;
  NEW.carried_meals := 0;
  NEW.batch_id_lunch := NULL;
  NEW.batch_id_dinner := NULL;
  NEW.renewed_from := NULL;
  NEW.pause_from := NULL;
  NEW.pause_until := NULL;
  NEW.end_date := NULL;
  NEW.last_renewal_reminder_sent_at := NULL;
  NEW.menu_type := 'M1';
  NEW.cod_due_paise := 0;
  NEW.cod_on_credit := false;
  -- Set only from a paid, server-priced coupon (apply_payment_coupon, 066).
  NEW.meal_price_paise := NULL;
  NEW.coupon_id := NULL;
  -- Pickup defaults only through set_my_collection (082).
  NEW.fulfilment_lunch := 'delivery';
  NEW.fulfilment_dinner := 'delivery';
  NEW.pickup_location_lunch := NULL;
  NEW.pickup_location_dinner := NULL;
  RETURN NEW;
END; $$;

-- ── Batches are for deliveries only ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.order_batch_from_address()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.fulfilment <> 'delivery' THEN
    NEW.batch_id := NULL;
  ELSIF NEW.address_id IS NOT NULL THEN
    SELECT CASE WHEN NEW.meal_slot = 'dinner' THEN a.batch_id_dinner ELSE a.batch_id_lunch END
      INTO NEW.batch_id
      FROM addresses a WHERE a.id = NEW.address_id;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS orders_batch_from_address ON public.orders;
CREATE TRIGGER orders_batch_from_address
  BEFORE INSERT OR UPDATE OF address_id, meal_slot, fulfilment ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.order_batch_from_address();

CREATE OR REPLACE FUNCTION public.address_batch_changed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF NEW.batch_id_lunch IS DISTINCT FROM OLD.batch_id_lunch THEN
    UPDATE orders SET batch_id = NEW.batch_id_lunch, updated_at = now()
     WHERE address_id = NEW.id AND meal_slot = 'lunch' AND delivery_date >= v_today
       AND fulfilment = 'delivery'
       AND status IN ('scheduled', 'confirmed', 'preparing');
  END IF;
  IF NEW.batch_id_dinner IS DISTINCT FROM OLD.batch_id_dinner THEN
    UPDATE orders SET batch_id = NEW.batch_id_dinner, updated_at = now()
     WHERE address_id = NEW.id AND meal_slot = 'dinner' AND delivery_date >= v_today
       AND fulfilment = 'delivery'
       AND status IN ('scheduled', 'confirmed', 'preparing');
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.sync_order_batches()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  UPDATE orders o
     SET batch_id = CASE WHEN o.meal_slot = 'dinner' THEN a.batch_id_dinner ELSE a.batch_id_lunch END,
         updated_at = now()
    FROM addresses a
   WHERE a.id = o.address_id
     AND o.fulfilment = 'delivery'
     AND o.delivery_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
     AND o.status IN ('scheduled', 'confirmed', 'preparing')
     AND o.batch_id IS DISTINCT FROM (CASE WHEN o.meal_slot = 'dinner' THEN a.batch_id_dinner ELSE a.batch_id_lunch END);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $$;
REVOKE ALL ON FUNCTION public.sync_order_batches() FROM PUBLIC, anon, authenticated;

-- ── The 6-digit code ────────────────────────────────────────────────────────
-- Unique among that day's open collections at that place; cleared for a delivery.
CREATE OR REPLACE FUNCTION public.orders_pickup_fields()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code text;
  n      integer := 0;
BEGIN
  IF NEW.fulfilment = 'delivery' THEN
    NEW.pickup_location_id := NULL;
    NEW.pickup_code := NULL;
    NEW.walk_in := false;
    RETURN NEW;
  END IF;
  IF NEW.pickup_code IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.pickup_location_id IS DISTINCT FROM OLD.pickup_location_id) THEN
    LOOP
      v_code := lpad(floor(random() * 1000000)::int::text, 6, '0');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM orders x
         WHERE x.delivery_date = NEW.delivery_date AND x.pickup_location_id = NEW.pickup_location_id
           AND x.pickup_code = v_code AND x.id IS DISTINCT FROM NEW.id
           AND x.status NOT IN ('cancelled', 'skipped'));
      n := n + 1;
      IF n > 50 THEN RAISE EXCEPTION 'Could not make a pickup code.'; END IF;
    END LOOP;
    NEW.pickup_code := v_code;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.orders_pickup_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS orders_pickup_fields ON public.orders;
CREATE TRIGGER orders_pickup_fields
  BEFORE INSERT OR UPDATE OF fulfilment, pickup_location_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_pickup_fields();

-- ── Shared checks ───────────────────────────────────────────────────────────
-- The customer's live plan that may collect, or an error.
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
    RAISE EXCEPTION 'Pickup and dine-in come with the 30- and 60-meal plans.';
  END IF;
  RETURN v_sub;
END; $$;
REVOKE ALL ON FUNCTION public.pickup_plan_for(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.check_pickup_place(p_location text, p_mode text)
RETURNS public.pickup_locations
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.pickup_locations;
BEGIN
  IF p_mode NOT IN ('pickup', 'dine_in') THEN RAISE EXCEPTION 'Pick takeaway or dine-in.'; END IF;
  SELECT * INTO l FROM pickup_locations WHERE id = p_location AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'That place isn''t open for pickups.'; END IF;
  IF p_mode = 'dine_in' AND NOT l.offers_dine_in THEN RAISE EXCEPTION '% is takeaway only.', l.name; END IF;
  IF p_mode = 'pickup' AND NOT l.offers_pickup THEN RAISE EXCEPTION '% is dine-in only.', l.name; END IF;
  RETURN l;
END; $$;
REVOKE ALL ON FUNCTION public.check_pickup_place(text, text) FROM PUBLIC, anon, authenticated;

-- A collected meal is the default meal: default dish, portions, add-ons and
-- price (080's defaults); extra dishes in that slot are cancelled.
CREATE OR REPLACE FUNCTION public.reset_to_default_meal(p_order uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o      record;
  s      record;
  v_qty  integer;
  v_dish text;
BEGIN
  SELECT id, subscription_id, user_id, delivery_date, meal_slot, meal_template_id INTO o FROM orders WHERE id = p_order;
  SELECT meals_lunch, meals_dinner INTO s FROM subscriptions WHERE id = o.subscription_id;
  v_qty := GREATEST(CASE o.meal_slot WHEN 'lunch' THEN COALESCE(s.meals_lunch, 0) ELSE COALESCE(s.meals_dinner, 0) END, 1);
  v_dish := plan_default_dish(o.user_id, o.delivery_date, o.meal_slot);

  UPDATE orders
     SET quantity = v_qty,
         unit_price = subscription_meal_rate(o.subscription_id) + addons_per_meal(o.subscription_id),
         meal_template_id = COALESCE(v_dish, meal_template_id),
         is_customized = plan_rule_dish(o.user_id, o.delivery_date, o.meal_slot) IS NOT NULL,
         cart_edited = false,
         switch_fee_paise = 0,
         updated_at = now()
   WHERE id = p_order;
  IF v_dish IS NOT NULL AND v_dish IS DISTINCT FROM o.meal_template_id THEN
    PERFORM snapshot_order_ingredients(p_order);
  END IF;

  DELETE FROM order_addons WHERE order_id = p_order;
  INSERT INTO order_addons (order_id, addon_id, sub_option)
  SELECT p_order, sa.addon_id, sa.sub_option FROM subscription_addons sa WHERE sa.subscription_id = o.subscription_id;
  PERFORM recompute_order_cart(p_order);

  UPDATE orders SET status = 'cancelled', skip_reason = 'user', updated_at = now()
   WHERE subscription_id = o.subscription_id AND delivery_date = o.delivery_date AND meal_slot = o.meal_slot
     AND COALESCE(extra_dish, false) AND NOT walk_in AND status IN ('scheduled', 'confirmed');
END; $$;
REVOKE ALL ON FUNCTION public.reset_to_default_meal(uuid) FROM PUBLIC, anon, authenticated;

-- ── Booking ahead ───────────────────────────────────────────────────────────
-- p_mode 'delivery' puts the day back on delivery (its batch comes back).
CREATE OR REPLACE FUNCTION public.set_order_fulfilment(p_order uuid, p_mode text, p_location text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o record;
  l public.pickup_locations;
BEGIN
  SELECT id, user_id, delivery_date, meal_slot, status, extra_dish, walk_in INTO o
    FROM orders WHERE id = p_order AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Meal not found.'; END IF;
  IF o.status NOT IN ('scheduled', 'confirmed') OR COALESCE(o.extra_dish, false) OR o.walk_in THEN
    RAISE EXCEPTION 'This meal can''t be changed.';
  END IF;
  IF is_slot_locked(o.delivery_date, o.meal_slot) THEN
    RAISE EXCEPTION 'This meal is already being prepared — changes close at 9 AM for lunch and 2 PM for dinner.';
  END IF;

  IF p_mode = 'delivery' THEN
    UPDATE orders SET fulfilment = 'delivery', pickup_location_id = NULL, updated_at = now() WHERE id = p_order;
  ELSE
    PERFORM pickup_plan_for(o.user_id);
    l := check_pickup_place(p_location, p_mode);
    PERFORM reset_to_default_meal(p_order);
    UPDATE orders SET fulfilment = p_mode, pickup_location_id = l.id, updated_at = now() WHERE id = p_order;
  END IF;

  RETURN (SELECT jsonb_build_object('order_id', id, 'fulfilment', fulfilment, 'location', pickup_location_id,
                                    'code', pickup_code, 'cart_total', cart_total)
            FROM orders WHERE id = p_order);
END; $$;
REVOKE ALL ON FUNCTION public.set_order_fulfilment(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_order_fulfilment(uuid, text, text) TO authenticated;

-- The plan's default for a slot; open meals still before their cutoff follow
-- it (days changed by hand stay on delivery as they are).
CREATE OR REPLACE FUNCTION public.set_my_collection(p_slot text, p_mode text, p_location text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_sub  uuid;
  l      public.pickup_locations;
  o      record;
  n      integer := 0;
BEGIN
  IF p_slot NOT IN ('lunch', 'dinner') THEN RAISE EXCEPTION 'Pick lunch or dinner.'; END IF;
  IF p_mode = 'delivery' THEN
    SELECT id INTO v_sub FROM subscriptions WHERE user_id = v_user AND status IN ('active', 'paused')
     ORDER BY created_at DESC LIMIT 1;
    IF v_sub IS NULL THEN RAISE EXCEPTION 'You need a live plan for this.'; END IF;
  ELSE
    v_sub := pickup_plan_for(v_user);
    l := check_pickup_place(p_location, p_mode);
  END IF;

  IF p_slot = 'lunch' THEN
    UPDATE subscriptions SET fulfilment_lunch = p_mode,
           pickup_location_lunch = CASE WHEN p_mode = 'delivery' THEN NULL ELSE l.id END, updated_at = now()
     WHERE id = v_sub;
  ELSE
    UPDATE subscriptions SET fulfilment_dinner = p_mode,
           pickup_location_dinner = CASE WHEN p_mode = 'delivery' THEN NULL ELSE l.id END, updated_at = now()
     WHERE id = v_sub;
  END IF;

  FOR o IN
    SELECT id, delivery_date, fulfilment, pickup_location_id FROM orders
     WHERE subscription_id = v_sub AND meal_slot = p_slot
       AND status IN ('scheduled', 'confirmed')
       AND delivery_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
       AND NOT COALESCE(extra_dish, false) AND NOT walk_in AND NOT cart_edited
     FOR UPDATE
  LOOP
    CONTINUE WHEN is_slot_locked(o.delivery_date, p_slot);
    IF p_mode = 'delivery' THEN
      CONTINUE WHEN o.fulfilment = 'delivery';
      UPDATE orders SET fulfilment = 'delivery', pickup_location_id = NULL, updated_at = now() WHERE id = o.id;
    ELSE
      CONTINUE WHEN o.fulfilment = p_mode AND o.pickup_location_id = l.id;
      PERFORM reset_to_default_meal(o.id);
      UPDATE orders SET fulfilment = p_mode, pickup_location_id = l.id, updated_at = now() WHERE id = o.id;
    END IF;
    n := n + 1;
  END LOOP;

  RETURN jsonb_build_object('updated', n);
END; $$;
REVOKE ALL ON FUNCTION public.set_my_collection(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_collection(text, text, text) TO authenticated;

-- ── Walk-ins ────────────────────────────────────────────────────────────────
-- Lunch until the place's lunch_until, dinner after; NULL when it's closed.
CREATE OR REPLACE FUNCTION public.pickup_slot_now(p_location text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN t < l.opens_at OR t >= l.closes_at THEN NULL
    WHEN t < l.lunch_until THEN 'lunch'
    ELSE 'dinner' END
  FROM public.pickup_locations l,
       LATERAL (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::time AS t) x
  WHERE l.id = p_location AND l.is_active
$$;
GRANT EXECUTE ON FUNCTION public.pickup_slot_now(text) TO authenticated, service_role;

-- What a walk-in here would be right now — shown before the customer confirms.
CREATE OR REPLACE FUNCTION public.walk_in_quote(p_location text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user  uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_sub   uuid;
  l       public.pickup_locations;
  v_slot  text;
  v_qty   integer;
  v_cost  integer;
  v_dish  text;
  v_open  record;
  v_base  record;
BEGIN
  BEGIN
    v_sub := pickup_plan_for(v_user);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
  END;
  SELECT * INTO l FROM pickup_locations WHERE id = p_location AND is_active;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'That place isn''t open for pickups.'); END IF;
  v_slot := pickup_slot_now(p_location);
  IF v_slot IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error',
      format('%s is open %s–%s.', l.name, to_char(l.opens_at, 'FMHH12:MI AM'), to_char(l.closes_at, 'FMHH12:MI AM')));
  END IF;

  -- Already has a walk-in waiting for this slot: show that one.
  SELECT id, pickup_code, pickup_location_id INTO v_open FROM orders
   WHERE user_id = v_user AND delivery_date = v_today AND meal_slot = v_slot AND walk_in
     AND status IN ('scheduled', 'confirmed', 'preparing')
   LIMIT 1;

  SELECT id, fulfilment, status INTO v_base FROM orders
   WHERE subscription_id = v_sub AND delivery_date = v_today AND meal_slot = v_slot
     AND NOT COALESCE(extra_dish, false) AND NOT walk_in
     AND status IN ('scheduled', 'confirmed', 'preparing', 'out_for_delivery', 'delivered')
   LIMIT 1;

  SELECT CASE v_slot WHEN 'lunch' THEN meals_lunch ELSE meals_dinner END INTO v_qty FROM subscriptions WHERE id = v_sub;
  v_qty := GREATEST(COALESCE(v_qty, 0), 1);
  v_cost := default_meal_cost(v_sub) * v_qty;
  v_dish := plan_default_dish(v_user, v_today, v_slot);

  RETURN jsonb_build_object(
    'ok', v_dish IS NOT NULL,
    'error', CASE WHEN v_dish IS NULL THEN 'There''s no dish on the menu for this meal today.' END,
    'slot', v_slot,
    'place', l.name,
    'offers_pickup', l.offers_pickup,
    'offers_dine_in', l.offers_dine_in,
    'closes', to_char(CASE v_slot WHEN 'lunch' THEN l.lunch_until ELSE l.closes_at END, 'FMHH12:MI AM'),
    'meal_name', (SELECT name FROM meal_templates WHERE id = v_dish),
    'portions', v_qty,
    'cost', v_cost,
    -- A meal already coming for this slot (delivery or booked): this is an extra.
    'extra', v_base.id IS NOT NULL,
    'already_booked_here', v_base.fulfilment IS DISTINCT FROM 'delivery' AND v_base.id IS NOT NULL,
    'can_afford', schedulable_paise(v_user) >= v_cost,
    'open_walk_in', CASE WHEN v_open.id IS NOT NULL THEN
        jsonb_build_object('order_id', v_open.id, 'code', v_open.pickup_code, 'location', v_open.pickup_location_id) END);
END; $$;
REVOKE ALL ON FUNCTION public.walk_in_quote(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.walk_in_quote(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.start_walk_in(p_location text, p_mode text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user  uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_sub   uuid;
  l       public.pickup_locations;
  v_slot  text;
  v_qty   integer;
  v_cost  integer;
  v_dish  text;
  v_id    uuid;
  v_seq   integer;
  v_extra boolean;
  v_open  record;
BEGIN
  v_sub := pickup_plan_for(v_user);
  l := check_pickup_place(p_location, p_mode);
  v_slot := pickup_slot_now(p_location);
  IF v_slot IS NULL THEN RAISE EXCEPTION '% is closed right now.', l.name; END IF;

  -- One open walk-in per meal: a second tap gets the same code back.
  SELECT id, pickup_code, pickup_location_id INTO v_open FROM orders
   WHERE user_id = v_user AND delivery_date = v_today AND meal_slot = v_slot AND walk_in
     AND status IN ('scheduled', 'confirmed', 'preparing')
   LIMIT 1;
  IF v_open.id IS NOT NULL THEN
    RETURN jsonb_build_object('order_id', v_open.id, 'code', v_open.pickup_code, 'slot', v_slot,
                              'location', v_open.pickup_location_id, 'existing', true);
  END IF;

  v_dish := plan_default_dish(v_user, v_today, v_slot);
  IF v_dish IS NULL THEN RAISE EXCEPTION 'There''s no dish on the menu for this meal today.'; END IF;
  SELECT CASE v_slot WHEN 'lunch' THEN meals_lunch ELSE meals_dinner END INTO v_qty FROM subscriptions WHERE id = v_sub;
  v_qty := GREATEST(COALESCE(v_qty, 0), 1);
  v_cost := default_meal_cost(v_sub) * v_qty;
  IF schedulable_paise(v_user) < v_cost THEN
    RAISE EXCEPTION 'Your wallet doesn''t have room for an extra meal — renew your plan to add one.';
  END IF;

  SELECT EXISTS (SELECT 1 FROM orders WHERE subscription_id = v_sub AND delivery_date = v_today
                   AND meal_slot = v_slot AND status NOT IN ('cancelled', 'skipped')) INTO v_extra;
  SELECT COALESCE(max(slot_seq), 0) + 1 INTO v_seq FROM orders
   WHERE subscription_id = v_sub AND delivery_date = v_today AND meal_slot = v_slot;

  INSERT INTO orders (user_id, subscription_id, meal_template_id, delivery_date, meal_slot, status,
                      quantity, unit_price, extra_dish, slot_seq, is_customized,
                      fulfilment, pickup_location_id, walk_in)
  VALUES (v_user, v_sub, v_dish, v_today, v_slot, 'confirmed',
          v_qty, default_meal_cost(v_sub), v_extra, v_seq,
          plan_rule_dish(v_user, v_today, v_slot) IS NOT NULL,
          p_mode, l.id, true)
  RETURNING id INTO v_id;

  PERFORM snapshot_order_ingredients(v_id);
  INSERT INTO order_addons (order_id, addon_id, sub_option)
  SELECT v_id, sa.addon_id, sa.sub_option FROM subscription_addons sa WHERE sa.subscription_id = v_sub;
  PERFORM recompute_order_cart(v_id);

  RETURN (SELECT jsonb_build_object('order_id', id, 'code', pickup_code, 'slot', meal_slot,
                                    'location', pickup_location_id, 'extra', v_extra, 'cost', cart_total, 'existing', false)
            FROM orders WHERE id = v_id);
END; $$;
REVOKE ALL ON FUNCTION public.start_walk_in(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_walk_in(text, text) TO authenticated;

-- ── The counter (admin, service role) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.redeem_pickup(p_order uuid, p_location text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o   record;
  res jsonb;
BEGIN
  SELECT id, fulfilment, pickup_location_id, delivery_date, status INTO o FROM orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND OR o.fulfilment = 'delivery' THEN RAISE EXCEPTION 'That isn''t a pickup.'; END IF;
  IF o.pickup_location_id IS DISTINCT FROM p_location THEN RAISE EXCEPTION 'That meal is booked at another place.'; END IF;
  IF o.delivery_date <> (now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'That code is for another day.'; END IF;
  IF o.status IN ('delivered') THEN RAISE EXCEPTION 'Already handed over.'; END IF;
  IF o.status IN ('cancelled', 'skipped') THEN RAISE EXCEPTION 'That meal was cancelled.'; END IF;

  res := advance_order_delivered(p_order);
  IF res->>'result' = 'billed' THEN
    UPDATE orders SET collected_at = now() WHERE id = p_order;
  END IF;
  RETURN res;
END; $$;
REVOKE ALL ON FUNCTION public.redeem_pickup(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_pickup(uuid, text) TO service_role;

-- ── Closing time ────────────────────────────────────────────────────────────
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
                AND v_now >= CASE x.meal_slot WHEN 'lunch' THEN l.lunch_until ELSE l.closes_at END))
     ORDER BY x.delivery_date, x.meal_slot
  LOOP
    IF o.walk_in THEN
      UPDATE orders SET status = 'cancelled', skip_reason = 'walk_in_expired', updated_at = now() WHERE id = o.id;
      v_expired := v_expired + 1;
    ELSE
      -- Booked and cooked, never collected: charged like a delivery.
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

SELECT cron.unschedule('gf-settle-pickups') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gf-settle-pickups');
SELECT cron.schedule('gf-settle-pickups', '*/15 * * * *', $$SELECT public.settle_pickups()$$);

-- ── Message ─────────────────────────────────────────────────────────────────
INSERT INTO public.notification_templates
  (key, sort_order, label, description, placeholders, title, body, default_title, default_body, enabled)
VALUES
  ('pickup_missed', 178, 'Pickup not collected',
   'At closing time: a booked pickup or dine-in nobody collected. It was cooked, so it''s charged.',
   '{name,slot,place,date}',
   'Your {slot} wasn''t collected',
   'Your {slot} at {place} on {date} wasn''t collected. It was cooked for you, so it''s been charged. Switch a day back to delivery in My Plan before the cutoff if plans change.',
   'Your {slot} wasn''t collected',
   'Your {slot} at {place} on {date} wasn''t collected. It was cooked for you, so it''s been charged. Switch a day back to delivery in My Plan before the cutoff if plans change.',
   true)
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
