-- ============================================================
-- GreenFeast — Migration 093: Address form rebuild, Jaipur pincodes
-- ============================================================
-- Why customers couldn't save addresses (found 2026-11-19):
--   addresses.city is NOT NULL, and since 1.10.12 the app worked the city out
--   with Google (Places pick, map pin, or Geocoding by pincode) and refused to
--   save when it got none. Google's geocoder returns ZERO_RESULTS for real
--   Jaipur pincodes, and on Android the map pin's reverse geocode needs a
--   location permission the map never asked for, so many customers were told
--   "pin your location on the map" and could never save. The service is
--   Jaipur-only, so the city now comes from the pincode, here.
--
-- 1. addresses: line2 (area / locality), place_id (the Google place picked),
--    location_source (where lat / lng came from).
-- 2. service_pincodes: the one list of pincodes we deliver to (India Post's
--    Jaipur-district list, 79 codes). 302xxx (Jaipur city) are on; the outer
--    district (303xxx) is stored but off. Switch one on with
--    UPDATE service_pincodes SET is_active = true WHERE pincode = '…';
--    The app and the admin read this table to check a pincode.
-- 3. Trigger addresses_normalize (BEFORE INSERT / UPDATE): trims fields, sets
--    city from the pincode (a missing city can never block a save again), and
--    refuses a customer's address whose pincode we don't serve. Admin /
--    service-key writes are not checked here (the admin checks in its action).
-- 4. is_default now defaults to false, and a customer's first active address
--    becomes the default by itself (an insert that left is_default out used to
--    hit the one-default index, addresses_one_default_per_user).
-- 5. Delivery partner stops and "address changed" alerts include line2.
-- ============================================================

-- 1. Columns ---------------------------------------------------
ALTER TABLE public.addresses
  ADD COLUMN IF NOT EXISTS line2 text,
  ADD COLUMN IF NOT EXISTS place_id text,
  ADD COLUMN IF NOT EXISTS location_source text;

DO $$ BEGIN
  ALTER TABLE public.addresses ADD CONSTRAINT addresses_location_source_check
    CHECK (location_source IS NULL OR location_source IN ('places', 'map', 'gps', 'manual', 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT INSERT (line2, place_id, location_source), UPDATE (line2, place_id, location_source)
  ON public.addresses TO authenticated;

ALTER TABLE public.addresses ALTER COLUMN is_default SET DEFAULT false;

-- 2. Pincodes we deliver to -------------------------------------
CREATE TABLE IF NOT EXISTS public.service_pincodes (
  pincode    text PRIMARY KEY CHECK (pincode ~ '^[0-9]{6}$'),
  area       text NOT NULL,
  city       text NOT NULL DEFAULT 'Jaipur',
  zone       text NOT NULL DEFAULT 'city' CHECK (zone IN ('city', 'district')),
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.service_pincodes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_pincodes_read ON public.service_pincodes;
CREATE POLICY service_pincodes_read ON public.service_pincodes
  FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.service_pincodes TO anon, authenticated;

-- India Post directory, district = Jaipur (api.postalpincode.in, 2026-11-19).
INSERT INTO public.service_pincodes (pincode, area, zone, is_active) VALUES
  ('302001', 'Ashok Nagar (Jaipur), Bhura Tiba, C.P.M.G', 'city', true),
  ('302002', 'Amer Road, Govind Nagar (Jaipur), Kishanpole Bazar', 'city', true),
  ('302003', 'Haldiyon Ka Rasta, Jaipur City, Krishi Upaj Mandi', 'city', true),
  ('302004', 'Arjun Lal Sethi Nagar, Janta Colony, Jawahar Nagar', 'city', true),
  ('302005', 'High Court (Jaipur), Legislative Assembly, N.C.R.Building', 'city', true),
  ('302006', 'Ajmer Road, Industrial Estate (Jaipur), Jaipur R.S.', 'city', true),
  ('302012', 'Industrial Area Jhotwara, Jhotwara, Khatipura', 'city', true),
  ('302013', 'Harmada, Road No-5 Vkia, Vishwakarma Industrial Area', 'city', true),
  ('302015', 'Bajaj Nagar, Bapu Nagar, Barkat Nagar', 'city', true),
  ('302016', 'Bani Park, Collectorate (Jaipur), Dwarikapuri', 'city', true),
  ('302017', 'Jagatpura, Malviya Nagar (Jaipur), Malviya Nagar Sector 11', 'city', true),
  ('302018', 'Amer Clark Hotel, Durgapura', 'city', true),
  ('302019', 'Shyam Nagar (Jaipur)', 'city', true),
  ('302020', 'Mansarovar, S.F.S.Mansarovar', 'city', true),
  ('302021', 'Heerapura, Vaishali Nagar', 'city', true),
  ('302022', 'Sitapura Industrial Area', 'city', true),
  ('302026', 'Bhankrota', 'city', true),
  ('302027', 'Crpf Campus  Lalwas', 'city', true),
  ('302028', 'Amer', 'city', true),
  ('302029', 'Airport Sanganer, Sanganer Bazar', 'city', true),
  ('302031', 'Jamdoli', 'city', true),
  ('302033', 'Pratap Nagar Housing Board, Pratap Nagar Sector 11', 'city', true),
  ('302034', 'Panchyawala', 'city', true),
  ('302036', 'Jaisinghpura Khore', 'city', true),
  ('302037', 'Mahindra World City (Jaipur)', 'city', true),
  ('302039', 'Amba Bari, Dehar Ka Balaji, Murlipura', 'city', true),
  ('302040', 'Nangal Jaisabohara', 'city', true),
  ('303001', 'Andhi', 'district', false),
  ('303002', 'Achrol', 'district', false),
  ('303003', 'Med', 'district', false),
  ('303005', 'Phagi', 'district', false),
  ('303006', 'Madhorajpura', 'district', false),
  ('303007', 'Bagru', 'district', false),
  ('303008', 'Dudu', 'district', false),
  ('303009', 'Mozmabad', 'district', false),
  ('303012', 'Kanota', 'district', false),
  ('303102', 'Virat Nagar', 'district', false),
  ('303103', 'Badi Jori, Badodia, Bidara', 'district', false),
  ('303104', 'Manoharpur (Jaipur)', 'district', false),
  ('303105', 'Nareda', 'district', false),
  ('303106', 'Paota(Jaipur)', 'district', false),
  ('303107', 'Pragpura', 'district', false),
  ('303108', 'Kotputli', 'district', false),
  ('303109', 'Jamwaramgarh', 'district', false),
  ('303110', 'Rajnauta', 'district', false),
  ('303119', 'Bhabroo', 'district', false),
  ('303120', 'Gathwadi', 'district', false),
  ('303121', 'NIMS University', 'district', false),
  ('303122', 'Vedaant Gyan Valley', 'district', false),
  ('303301', 'Bassi (Jaipur)', 'district', false),
  ('303302', 'Toonga', 'district', false),
  ('303305', 'Badwa, Dharampura, Dhula', 'district', false),
  ('303328', 'Jobner', 'district', false),
  ('303329', 'A C Jobner', 'district', false),
  ('303338', 'Phulera, Phulera Bazar', 'district', false),
  ('303348', 'Naraina', 'district', false),
  ('303503', 'Kalyanpura', 'district', false),
  ('303507', 'Nabhawala', 'district', false),
  ('303509', 'Udaipuria', 'district', false),
  ('303601', 'Amarsar', 'district', false),
  ('303602', 'Badhal', 'district', false),
  ('303603', 'Renwal', 'district', false),
  ('303604', 'Asalpur, Bichoon, Habaspura', 'district', false),
  ('303701', 'Jahota', 'district', false),
  ('303702', 'Chomu, Tripolia Chomu', 'district', false),
  ('303704', 'Jaitpura I A', 'district', false),
  ('303706', 'Kalwad', 'district', false),
  ('303712', 'Govindgarh (Jaipur)', 'district', false),
  ('303801', 'Kaladera', 'district', false),
  ('303803', 'Khejroli', 'district', false),
  ('303804', 'Etwa Bhopji', 'district', false),
  ('303805', 'Morija', 'district', false),
  ('303806', 'Samod', 'district', false),
  ('303807', 'Udaipuria', 'district', false),
  ('303901', 'Chaksu', 'district', false),
  ('303903', 'Shivdaspura', 'district', false),
  ('303904', 'Chittora Renwal', 'district', false),
  ('303905', 'Watika', 'district', false),
  ('303908', 'Kotkhawada', 'district', false)
ON CONFLICT (pincode) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_service_pincode(p text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM service_pincodes WHERE pincode = btrim(p) AND is_active);
$$;
GRANT EXECUTE ON FUNCTION public.is_service_pincode(text) TO anon, authenticated;

-- 3 + 4. Normalise every address write ---------------------------
CREATE OR REPLACE FUNCTION public.address_normalize()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  -- The caller's login role (current_user is this function's owner here).
  v_customer boolean := COALESCE(auth.role(), '') = 'authenticated';
  v_city     text;
BEGIN
  NEW.line1    := btrim(regexp_replace(COALESCE(NEW.line1, ''), '\s+', ' ', 'g'));
  NEW.line2    := NULLIF(btrim(regexp_replace(COALESCE(NEW.line2, ''), '\s+', ' ', 'g')), '');
  NEW.landmark := NULLIF(btrim(COALESCE(NEW.landmark, '')), '');
  NEW.pincode  := regexp_replace(COALESCE(NEW.pincode, ''), '\s', '', 'g');

  IF v_customer AND (TG_OP = 'INSERT' OR NEW.pincode IS DISTINCT FROM OLD.pincode) THEN
    IF NEW.pincode !~ '^[0-9]{6}$' THEN
      RAISE EXCEPTION 'Please enter your 6-digit pincode.' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT is_service_pincode(NEW.pincode) THEN
      RAISE EXCEPTION 'We deliver only in Jaipur for now, and % is outside our area. Please check the pincode.', NEW.pincode
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF v_customer AND (TG_OP = 'INSERT' OR NEW.line1 IS DISTINCT FROM OLD.line1) AND length(NEW.line1) < 3 THEN
    RAISE EXCEPTION 'Please enter your house / flat number and street.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT city INTO v_city FROM service_pincodes WHERE pincode = NEW.pincode;
  NEW.city := COALESCE(v_city, NULLIF(btrim(COALESCE(NEW.city, '')), ''), 'Jaipur');

  IF TG_OP = 'INSERT' AND NEW.archived_at IS NULL AND NOT COALESCE(NEW.is_default, false)
     AND NOT EXISTS (SELECT 1 FROM addresses
                      WHERE user_id = NEW.user_id AND is_default AND archived_at IS NULL) THEN
    NEW.is_default := true;
  END IF;
  NEW.is_default := COALESCE(NEW.is_default, false);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS addresses_normalize ON public.addresses;
CREATE TRIGGER addresses_normalize BEFORE INSERT OR UPDATE ON public.addresses
  FOR EACH ROW EXECUTE FUNCTION public.address_normalize();

-- 5. Delivery partners see line 2 --------------------------------
CREATE OR REPLACE FUNCTION public.partner_batch_stops(p_batch uuid, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

DECLARE

  p       public.delivery_partners;

  b       public.batches;

  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;

  v_date  date;

  v       jsonb;

BEGIN

  p := public.current_partner();

  IF p.id IS NULL THEN

    RAISE EXCEPTION 'Not signed in as a delivery partner.' USING ERRCODE = '42501';

  END IF;

  SELECT * INTO b FROM public.batches

   WHERE id = p_batch AND (primary_partner_id = p.id OR secondary_partner_id = p.id);

  IF NOT FOUND THEN

    RETURN NULL;

  END IF;

  -- Today to act on; a week either side to look at.

  v_date := CASE WHEN p_date BETWEEN v_today - 7 AND v_today + 7 THEN p_date ELSE v_today END;



  WITH o AS (

    SELECT o.id, o.address_id, o.user_id, o.subscription_id, o.created_at,

           u.name AS customer, u.phone,

           a.label, a.type AS addr_type, a.line1, a.line2, a.landmark, a.pincode, a.time_window AS timing, a.lat, a.lng,

           s.cod_due_paise, s.special_notes,

           jsonb_build_object(

             'orderId', o.id,

             'meal', COALESCE(mt.name, 'Meal'),

             'qty', COALESCE(o.quantity, 1),

             'extra', COALESCE(o.extra_dish, false),

             'addons', public.order_addon_lines(o.id, COALESCE(o.quantity, 1), COALESCE(o.extra_dish, false)),

             'status', o.status,

             'deliveredAt', o.delivered_at,

             'outAt', o.out_for_delivery_at,

             'issue', o.delivery_issue,

             'hasPhoto', o.delivery_photo_path IS NOT NULL) AS item

      FROM public.orders o

      JOIN public.users u ON u.id = o.user_id

      JOIN public.subscriptions s ON s.id = o.subscription_id

      LEFT JOIN public.addresses a ON a.id = o.address_id

      LEFT JOIN public.meal_templates mt ON mt.id = o.meal_template_id

     WHERE o.batch_id = b.id

       AND o.delivery_date = v_date

       AND o.meal_slot = b.meal_slot

       AND o.status NOT IN ('cancelled', 'skipped')

       AND u.is_test = p.is_test

  ), stops AS (

    SELECT COALESCE(address_id, id) AS stop_key,

           min(address_id::text)::uuid AS address_id,

           min(customer) AS name,

           min(phone) AS phone,

           min(CASE WHEN address_id IS NULL THEN 'No address'

                    ELSE COALESCE(NULLIF(btrim(label), ''), NULLIF(btrim(addr_type), ''), 'Address') END) AS label,

           min(CASE WHEN address_id IS NULL THEN 'No address saved — call the customer'

                    ELSE concat_ws(', ', NULLIF(btrim(line1), ''), NULLIF(btrim(line2), ''), NULLIF(btrim(landmark), '')) END) AS address,

           min(pincode) AS pincode,

           min(timing) AS timing,

           min(lat) AS lat,

           min(lng) AS lng,

           min(subscription_id::text)::uuid AS subscription_id,

           min(user_id::text)::uuid AS user_id,

           max(COALESCE(cod_due_paise, 0)) AS cod_due,

           min(NULLIF(btrim(special_notes), '')) AS note,

           jsonb_agg(item ORDER BY created_at) AS items

      FROM o

     GROUP BY 1

  )

  SELECT jsonb_build_object(

           'batch', jsonb_build_object('id', b.id, 'name', b.name, 'area', b.area, 'slot', b.meal_slot, 'time_window', b.time_window),

           'date', v_date,

           'today', v_today,

           'stops', COALESCE(jsonb_agg(jsonb_build_object(

             'key', st.stop_key,

             'addressId', st.address_id,

             'seq', rs.seq,

             'name', COALESCE(st.name, 'Customer'),

             'phone', COALESCE(st.phone, ''),

             'label', st.label,

             'address', st.address,

             'pincode', st.pincode,

             'timing', st.timing,

             'lat', st.lat,

             'lng', st.lng,

             'subscriptionId', st.subscription_id,

             'userId', st.user_id,

             'codDue', st.cod_due,

             'cashReport', (SELECT jsonb_build_object('id', cr.id, 'amount', cr.amount_paise)

                              FROM public.cash_reports cr

                             WHERE cr.subscription_id = st.subscription_id

                               AND cr.recorded_at IS NULL AND cr.dismissed_at IS NULL

                             ORDER BY cr.reported_at DESC LIMIT 1),

             'note', st.note,

             'items', st.items

           ) ORDER BY rs.seq NULLS LAST, st.name), '[]'::jsonb))

    INTO v

    FROM stops st

    LEFT JOIN public.route_stops rs ON rs.batch_id = b.id AND rs.address_id = st.address_id;

  RETURN v;

END; $function$
;

CREATE OR REPLACE FUNCTION public.orders_notify_partners()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_name  text;
  v_test  boolean;
  v_vars  jsonb;
  v_data  jsonb;
  v_addr  text;
BEGIN
  IF NEW.delivery_date <> v_today OR NOT public.is_slot_locked(NEW.delivery_date, NEW.meal_slot) THEN
    RETURN NULL;
  END IF;

  BEGIN
    SELECT btrim(name), is_test INTO v_name, v_test FROM public.users WHERE id = NEW.user_id;
    v_vars := jsonb_build_object('name', COALESCE(NULLIF(v_name, ''), 'Customer'), 'slot', NEW.meal_slot);

    IF TG_OP = 'INSERT' THEN
      IF NEW.batch_id IS NOT NULL AND NEW.status IN ('scheduled', 'confirmed', 'preparing') THEN
        PERFORM public.notify_batch_partners(NEW.batch_id, v_test, 'stop_added',
          v_vars || jsonb_build_object('batch', (SELECT btrim(name) FROM public.batches WHERE id = NEW.batch_id)),
          jsonb_build_object('batch_id', NEW.batch_id));
      END IF;
      RETURN NULL;
    END IF;

    -- Cancelled / skipped by the office or the customer — not the partner's
    -- own wallet-short tap, a failed drop the office settled (that's
    -- drop_skipped), or a kitchen closure (announced as one message).
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('cancelled', 'skipped') THEN
      IF OLD.status IN ('scheduled', 'confirmed', 'preparing', 'out_for_delivery')
         AND COALESCE(NEW.skip_reason, '') NOT IN ('insufficient_balance', 'not_delivered', 'kitchen_closed')
         AND NEW.batch_id IS NOT NULL THEN
        PERFORM public.notify_batch_partners(NEW.batch_id, v_test, 'stop_cancelled', v_vars,
          jsonb_build_object('batch_id', NEW.batch_id));
      END IF;
      RETURN NULL;
    END IF;
    IF NEW.status NOT IN ('scheduled', 'confirmed', 'preparing', 'out_for_delivery') THEN
      RETURN NULL;
    END IF;

    IF NEW.batch_id IS DISTINCT FROM OLD.batch_id THEN
      IF OLD.batch_id IS NOT NULL THEN
        PERFORM public.notify_batch_partners(OLD.batch_id, v_test, 'stop_moved_away', v_vars,
          jsonb_build_object('batch_id', OLD.batch_id));
      END IF;
      IF NEW.batch_id IS NOT NULL THEN
        PERFORM public.notify_batch_partners(NEW.batch_id, v_test, 'stop_added',
          v_vars || jsonb_build_object('batch', (SELECT btrim(name) FROM public.batches WHERE id = NEW.batch_id)),
          jsonb_build_object('batch_id', NEW.batch_id));
      END IF;
    ELSIF NEW.address_id IS DISTINCT FROM OLD.address_id AND NEW.batch_id IS NOT NULL THEN
      SELECT concat_ws(', ', NULLIF(btrim(line1), ''), NULLIF(btrim(line2), ''), NULLIF(btrim(landmark), '')) INTO v_addr
        FROM public.addresses WHERE id = NEW.address_id;
      PERFORM public.notify_batch_partners(NEW.batch_id, v_test, 'stop_address_changed',
        v_vars || jsonb_build_object('address', COALESCE(v_addr, '—')),
        jsonb_build_object('batch_id', NEW.batch_id));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'orders_notify_partners: %', SQLERRM;
  END;
  RETURN NULL;
END; $function$
;
