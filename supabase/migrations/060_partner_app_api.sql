-- ============================================================
-- GreenFeast — Migration 060: the delivery partner app's API
-- ============================================================
-- The delivery partner app is its own Expo (React Native) app —
-- greenfeast-delivery-partner repo: Android/iOS builds and a web version
-- from one codebase. It has no server holding the service key, so all it
-- reads and does goes through the functions below, called with the
-- partner's own session (Supabase Auth, email p<10-digit phone>@partners…
-- set up by the admin). Every function first finds the active delivery
-- partner behind auth.uid() and only touches that partner's batches
-- (primary or backup), today's meals, and customers in the partner's own
-- Live/Test world. Billing and messages go through the same functions as
-- the admin's buttons: advance_order_delivered, and the Automated messages
-- (notify_event) — logged in the admin's notification history too.
-- ============================================================

-- ── Internal helpers (not callable from the apps) ─────────────────────────

-- The active delivery partner behind this session, or a row of NULLs.
CREATE OR REPLACE FUNCTION public.current_partner()
RETURNS public.delivery_partners
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.delivery_partners
   WHERE user_id = auth.uid() AND status = 'active'
   LIMIT 1;
$$;

-- Every order must exist, be today's (IST), sit on one of this partner's
-- batches and belong to a customer in the partner's Live/Test world.
CREATE OR REPLACE FUNCTION public.partner_check_orders(p_partner uuid, p_is_test boolean, p_orders uuid[])
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_orders IS NULL OR cardinality(p_orders) = 0 OR cardinality(p_orders) > 20 THEN
    RAISE EXCEPTION 'Nothing to update.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM unnest(p_orders) AS x(id)
      LEFT JOIN public.orders o ON o.id = x.id
      LEFT JOIN public.users u ON u.id = o.user_id
      LEFT JOIN public.batches b ON b.id = o.batch_id
     WHERE o.id IS NULL
        OR o.delivery_date <> (now() AT TIME ZONE 'Asia/Kolkata')::date
        OR u.is_test IS DISTINCT FROM p_is_test
        OR b.id IS NULL
        OR NOT (COALESCE(b.primary_partner_id = p_partner, false) OR COALESCE(b.secondary_partner_id = p_partner, false))
  ) THEN
    RAISE EXCEPTION 'Some of these meals aren''t on your list any more — refresh.' USING ERRCODE = 'P0001';
  END IF;
END; $$;

-- What to hand over: plan add-ons come once per portion, anything else
-- carries its own count (same counting as the admin's Operations page).
CREATE OR REPLACE FUNCTION public.order_addon_lines(p_order uuid, p_qty integer, p_extra boolean)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(CASE WHEN n > 1 THEN name || ' ×' || n ELSE name END ORDER BY name), '[]'::jsonb)
    FROM (
      SELECT ad.name,
             COALESCE(oa.quantity, 1) * CASE WHEN oa.unit_price IS NULL AND NOT p_extra THEN p_qty ELSE 1 END AS n
        FROM public.order_addons oa
        JOIN public.addons ad ON ad.id = oa.addon_id
       WHERE oa.order_id = p_order AND oa.kind = 'addon'
    ) lines;
$$;

-- The "on its way" / "delivered" messages: one per customer through the
-- Automated messages, plus a row in the admin's notification history.
CREATE OR REPLACE FUNCTION public.partner_notify(p_users uuid[], p_key text, p_vars jsonb, p_audience text, p_partner text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t         public.notification_templates%ROWTYPE;
  u         record;
  v_results jsonb := '[]'::jsonb;
  v_sent    integer := 0;
BEGIN
  SELECT * INTO t FROM public.notification_templates WHERE key = p_key;
  IF NOT FOUND OR NOT t.enabled OR p_users IS NULL OR cardinality(p_users) = 0 THEN
    RETURN;
  END IF;
  FOR u IN SELECT id, name, expo_push_token FROM public.users WHERE id = ANY (p_users) LOOP
    PERFORM public.notify_event(u.id, p_key, p_vars, 'delivery_status');
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'user_id', u.id,
      'name', COALESCE(u.name, 'Customer'),
      'push', CASE WHEN COALESCE(u.expo_push_token, '') <> '' THEN 'sent' ELSE 'no_token' END));
    IF COALESCE(u.expo_push_token, '') <> '' THEN v_sent := v_sent + 1; END IF;
  END LOOP;

  INSERT INTO public.notification_broadcasts
    (type, title, body, channels, audience, recipient_count, push_sent_count, whatsapp_sent_count, results, created_by)
  VALUES (
    'delivery_status',
    public.render_template(t.title, COALESCE(p_vars, '{}'::jsonb) || jsonb_build_object('name', '{name}')),
    public.render_template(t.body, COALESCE(p_vars, '{}'::jsonb) || jsonb_build_object('name', '{name}')),
    ARRAY['push'],
    jsonb_build_object('description', p_audience, 'count', jsonb_array_length(v_results)),
    jsonb_array_length(v_results), v_sent, 0, v_results,
    'Partner app — ' || p_partner);
END; $$;

REVOKE ALL ON FUNCTION public.current_partner() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.partner_check_orders(uuid, boolean, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.order_addon_lines(uuid, integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.partner_notify(uuid[], text, jsonb, text, text) FROM PUBLIC, anon, authenticated;

-- ── Who am I ───────────────────────────────────────────────────────────────
-- NULL when the session isn't an active partner (the app signs out).
CREATE OR REPLACE FUNCTION public.partner_me()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.delivery_partners;
BEGIN
  p := public.current_partner();
  IF p.id IS NULL THEN
    RETURN NULL;
  END IF;
  -- "Last active" on the admin's Delivery Partners page (≤ one write / 5 min).
  IF p.last_seen_at IS NULL OR p.last_seen_at < now() - interval '5 minutes' THEN
    UPDATE public.delivery_partners SET last_seen_at = now() WHERE id = p.id;
  END IF;
  RETURN jsonb_build_object(
    'id', p.id, 'name', p.name, 'phone', p.phone, 'is_test', p.is_test,
    'today', (now() AT TIME ZONE 'Asia/Kolkata')::date);
END; $$;

-- ── The partner's batches, with per-day counts ─────────────────────────────
CREATE OR REPLACE FUNCTION public.partner_batches(p_dates date[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.delivery_partners;
  v jsonb;
BEGIN
  p := public.current_partner();
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'Not signed in as a delivery partner.' USING ERRCODE = '42501';
  END IF;

  WITH pb AS (
    SELECT * FROM public.batches
     WHERE primary_partner_id = p.id OR secondary_partner_id = p.id
  ), o AS (
    SELECT o.batch_id, o.delivery_date, COALESCE(o.address_id, o.id) AS stop_key, o.subscription_id,
           COALESCE(o.quantity, 1) AS qty,
           o.status NOT IN ('delivered', 'cancelled', 'skipped') AS is_open,
           o.delivery_issue IS NOT NULL AS has_issue
      FROM public.orders o
      JOIN pb ON pb.id = o.batch_id
      JOIN public.users u ON u.id = o.user_id
     WHERE o.delivery_date = ANY (p_dates)
       AND o.meal_slot = pb.meal_slot
       AND o.status NOT IN ('cancelled', 'skipped')
       AND u.is_test = p.is_test
  ), stops AS (
    SELECT batch_id, delivery_date, stop_key, sum(qty) AS meals,
           bool_or(is_open) AS pending, bool_or(is_open AND has_issue) AS has_problem
      FROM o GROUP BY 1, 2, 3
  ), cash AS (
    SELECT x.batch_id, x.delivery_date, sum(s.cod_due_paise) AS cash
      FROM (SELECT DISTINCT batch_id, delivery_date, subscription_id FROM o) x
      JOIN public.subscriptions s ON s.id = x.subscription_id
     WHERE s.cod_due_paise > 0
     GROUP BY 1, 2
  ), days AS (
    SELECT st.batch_id, st.delivery_date,
           jsonb_build_object(
             'stops', count(*),
             'meals', sum(st.meals),
             'done', count(*) FILTER (WHERE NOT st.pending),
             'issues', count(*) FILTER (WHERE st.has_problem),
             'cash', COALESCE(max(c.cash), 0)) AS stats
      FROM stops st
      LEFT JOIN cash c ON c.batch_id = st.batch_id AND c.delivery_date = st.delivery_date
     GROUP BY st.batch_id, st.delivery_date
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', pb.id, 'name', pb.name, 'area', pb.area, 'slot', pb.meal_slot, 'time_window', pb.time_window,
           'role', CASE WHEN pb.primary_partner_id = p.id THEN 'primary' ELSE 'secondary' END,
           'days', COALESCE((SELECT jsonb_object_agg(d.delivery_date::text, d.stats) FROM days d WHERE d.batch_id = pb.id), '{}'::jsonb)
         ) ORDER BY CASE pb.meal_slot WHEN 'lunch' THEN 0 ELSE 1 END, pb.name), '[]'::jsonb)
    INTO v
    FROM pb;
  RETURN v;
END; $$;

-- ── One batch's stops for a day ────────────────────────────────────────────
-- One stop per address (portions and extra dishes going there together), in
-- the partner's saved order. NULL when the batch isn't theirs any more.
CREATE OR REPLACE FUNCTION public.partner_batch_stops(p_batch uuid, p_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
           a.label, a.type AS addr_type, a.line1, a.landmark, a.pincode, a.time_window AS timing, a.lat, a.lng,
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
                    ELSE concat_ws(', ', NULLIF(btrim(line1), ''), NULLIF(btrim(landmark), '')) END) AS address,
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
END; $$;

-- ── Start delivery: today's batch goes "on the way" with this partner ──────
CREATE OR REPLACE FUNCTION public.partner_start_delivery(p_batch uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p       public.delivery_partners;
  b       public.batches;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_moved integer;
  v_users uuid[];
BEGIN
  p := public.current_partner();
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'Not signed in as a delivery partner.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO b FROM public.batches
   WHERE id = p_batch AND (primary_partner_id = p.id OR secondary_partner_id = p.id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That batch isn''t yours any more — ask the office.' USING ERRCODE = 'P0001';
  END IF;

  WITH moved AS (
    UPDATE public.orders o
       SET status = 'out_for_delivery', delivery_partner_id = p.id, updated_at = now()
     WHERE o.batch_id = b.id
       AND o.delivery_date = v_today
       AND o.meal_slot = b.meal_slot
       AND o.status IN ('scheduled', 'confirmed', 'preparing')
       AND o.user_id IN (SELECT id FROM public.users WHERE is_test = p.is_test)
    RETURNING o.user_id
  )
  SELECT count(*), array_agg(DISTINCT user_id) INTO v_moved, v_users FROM moved;

  IF v_moved > 0 THEN
    PERFORM public.partner_notify(
      v_users, 'out_for_delivery',
      jsonb_build_object('slot', b.meal_slot, 'rider', split_part(btrim(p.name), ' ', 1)),
      format('Batch %s, %s %s, status=out_for_delivery by %s', b.name, v_today, b.meal_slot, p.name),
      p.name);
  END IF;
  RETURN jsonb_build_object('moved', v_moved);
END; $$;

-- ── Delivered: bill each open meal at the stop, like the office's button ───
-- p_photo: the optional handover photo the app just uploaded
-- (delivery-photos/<today>/<order id>-….jpg).
CREATE OR REPLACE FUNCTION public.partner_mark_delivered(p_orders uuid[], p_photo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p        public.delivery_partners;
  v_today  date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  o        record;
  v_r      text;
  v_res    jsonb := '{}'::jsonb;
  v_billed uuid[] := '{}';
  v_short  integer := 0;
  v_slot   text;
  v_users  uuid[];
BEGIN
  p := public.current_partner();
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'Not signed in as a delivery partner.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.partner_check_orders(p.id, p.is_test, p_orders);

  IF p_photo IS NOT NULL AND (
       p_photo NOT LIKE v_today::text || '/%'
       OR NOT EXISTS (SELECT 1 FROM unnest(p_orders) x(id) WHERE position(x.id::text IN p_photo) > 0)
       OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'delivery-photos' AND so.name = p_photo)) THEN
    RAISE EXCEPTION 'That photo doesn''t belong to this stop — take it again.' USING ERRCODE = 'P0001';
  END IF;

  FOR o IN
    SELECT id, meal_slot FROM public.orders
     WHERE id = ANY (p_orders) AND status NOT IN ('delivered', 'cancelled', 'skipped')
     ORDER BY created_at
  LOOP
    v_r := public.advance_order_delivered(o.id) ->> 'result';
    v_res := v_res || jsonb_build_object(o.id::text, v_r);
    v_slot := o.meal_slot;
    IF v_r = 'billed' THEN
      v_billed := v_billed || o.id;
    ELSIF v_r = 'skipped_insufficient' THEN
      v_short := v_short + 1;
    END IF;
  END LOOP;

  IF cardinality(v_billed) > 0 THEN
    UPDATE public.orders
       SET delivery_partner_id = p.id, delivery_photo_path = COALESCE(p_photo, delivery_photo_path)
     WHERE id = ANY (v_billed);
    SELECT array_agg(DISTINCT user_id) INTO v_users FROM public.orders WHERE id = ANY (v_billed);
    PERFORM public.partner_notify(
      v_users, 'delivered', jsonb_build_object('slot', v_slot),
      format('Orders %s, status=delivered by %s', array_to_string(v_billed, ', '), p.name),
      p.name);
  END IF;
  RETURN jsonb_build_object('results', v_res, 'billed', cardinality(v_billed), 'short', v_short);
END; $$;

-- ── Couldn't deliver: unbilled, flagged for the office to decide ──────────
CREATE OR REPLACE FUNCTION public.partner_report_problem(p_orders uuid[], p_reason text, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p   public.delivery_partners;
  v_n integer;
BEGIN
  p := public.current_partner();
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'Not signed in as a delivery partner.' USING ERRCODE = '42501';
  END IF;
  -- Same list as the app's buttons (src/lib/reasons.ts).
  IF p_reason IS NULL OR p_reason NOT IN ('Not answering', 'Wrong address', 'Customer refused', 'No one home / gate locked', 'Other') THEN
    RAISE EXCEPTION 'Pick a reason.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.partner_check_orders(p.id, p.is_test, p_orders);

  UPDATE public.orders
     SET delivery_issue = CASE WHEN btrim(COALESCE(p_note, '')) <> ''
                               THEN p_reason || ' — ' || left(btrim(p_note), 200) ELSE p_reason END,
         delivery_issue_at = now(),
         delivery_partner_id = p.id
   WHERE id = ANY (p_orders) AND status NOT IN ('delivered', 'cancelled', 'skipped');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'This stop is already done.' USING ERRCODE = 'P0001';
  END IF;
  RETURN jsonb_build_object('reported', v_n);
END; $$;

-- ── Cash collected at the door: the office records it later ───────────────
-- Reporting again replaces this partner's earlier (still open) report.
CREATE OR REPLACE FUNCTION public.partner_report_cash(p_order uuid, p_amount integer, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p      public.delivery_partners;
  v_sub  uuid;
  v_user uuid;
  v_note text := NULLIF(left(btrim(COALESCE(p_note, '')), 200), '');
BEGIN
  p := public.current_partner();
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'Not signed in as a delivery partner.' USING ERRCODE = '42501';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 20000000 THEN
    RAISE EXCEPTION 'Enter the amount you collected.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.partner_check_orders(p.id, p.is_test, ARRAY[p_order]);

  SELECT subscription_id, user_id INTO v_sub, v_user FROM public.orders WHERE id = p_order;
  IF NOT EXISTS (SELECT 1 FROM public.subscriptions WHERE id = v_sub AND cod_due_paise > 0) THEN
    RAISE EXCEPTION 'No cash is due from this customer.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.cash_reports
     SET amount_paise = p_amount, note = v_note, reported_at = now(), order_id = p_order
   WHERE subscription_id = v_sub AND partner_id = p.id
     AND recorded_at IS NULL AND dismissed_at IS NULL;
  IF NOT FOUND THEN
    INSERT INTO public.cash_reports (subscription_id, user_id, partner_id, order_id, amount_paise, note)
    VALUES (v_sub, v_user, p.id, p_order, p_amount, v_note);
  END IF;
  RETURN jsonb_build_object('amount', p_amount);
END; $$;

-- ── The partner's stop order for a batch, kept for next time ───────────────
CREATE OR REPLACE FUNCTION public.partner_save_route(p_batch uuid, p_addresses uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p   public.delivery_partners;
  v_n integer;
BEGIN
  p := public.current_partner();
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'Not signed in as a delivery partner.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.batches
                  WHERE id = p_batch AND (primary_partner_id = p.id OR secondary_partner_id = p.id)) THEN
    RAISE EXCEPTION 'That batch isn''t yours any more — ask the office.' USING ERRCODE = 'P0001';
  END IF;

  -- Only addresses that ride this batch; a repeated id keeps its first place.
  INSERT INTO public.route_stops (batch_id, address_id, seq, updated_at)
  SELECT p_batch, x.id, (row_number() OVER (ORDER BY x.ord)) - 1, now()
    FROM (SELECT DISTINCT ON (id) id, ord
            FROM unnest(p_addresses[1:200]) WITH ORDINALITY AS u(id, ord)
           ORDER BY id, ord) x
    JOIN public.addresses a ON a.id = x.id
   WHERE a.batch_id_lunch = p_batch OR a.batch_id_dinner = p_batch
  ON CONFLICT (batch_id, address_id) DO UPDATE SET seq = EXCLUDED.seq, updated_at = now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('saved', v_n);
END; $$;

-- ── Who may call what ──────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.partner_me() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_batches(date[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_batch_stops(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_start_delivery(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_mark_delivered(uuid[], text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_report_problem(uuid[], text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_report_cash(uuid, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_save_route(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_me() TO authenticated;
GRANT EXECUTE ON FUNCTION public.partner_batches(date[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partner_batch_stops(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partner_start_delivery(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partner_mark_delivered(uuid[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partner_report_problem(uuid[], text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partner_report_cash(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partner_save_route(uuid, uuid[]) TO authenticated;

-- ── Handover photos: partners upload into today's folder ───────────────────
-- Storage rules run as the signed-in user, who can't read delivery_partners —
-- so the "is this an active partner" check is a definer function.
CREATE OR REPLACE FUNCTION public.is_active_partner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.delivery_partners WHERE user_id = auth.uid() AND status = 'active');
$$;
REVOKE ALL ON FUNCTION public.is_active_partner() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_partner() TO authenticated;

DROP POLICY IF EXISTS "Delivery partners upload handover photos" ON storage.objects;
CREATE POLICY "Delivery partners upload handover photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'delivery-photos'
    AND (storage.foldername(name))[1] = to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD')
    AND public.is_active_partner()
  );

DROP POLICY IF EXISTS "Delivery partners read their own handover photos" ON storage.objects;
CREATE POLICY "Delivery partners read their own handover photos" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'delivery-photos' AND owner = auth.uid());
