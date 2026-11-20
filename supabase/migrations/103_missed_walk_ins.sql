-- 103: Missed walk-ins (2026-11-20).
--
-- A walk-in code is live at the Counter for one hour. If nobody hands it over
-- in that hour (say no admin was at the counter), it moves to Missed walk-ins:
-- status 'cancelled', skip_reason 'walk_in_missed', nothing charged, and the
-- customer can start a new walk-in if they didn't get their food. For 7 days
-- an admin can mark it served — the cart is charged exactly as ordered, dated
-- the day it was eaten (admin_charge_missed_walk_in, action password + reason)
-- — or say it wasn't (admin_dismiss_missed_walk_in), or leave it. After 7 days
-- an unanswered one becomes 'walk_in_expired' (not collected, never charged).
--
-- settle_pickups now runs every 5 minutes (was 15) so "an hour" stays close to
-- one. Walk-ins that lapsed in the last 7 days under the old closing-time rule
-- become missed, so they can still be marked served.

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_skip_reason_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_skip_reason_check CHECK (
  skip_reason = ANY (ARRAY['user', 'insufficient_balance', 'pause', 'admin', 'plan_finished',
                           'kitchen_closed', 'not_delivered', 'off_day', 'walk_in_expired', 'walk_in_missed'])
);

-- ── The job ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.settle_pickups()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_now   time := (now() AT TIME ZONE 'Asia/Kolkata')::time;
  o       record;
  res     jsonb;
  v_billed  integer := 0;
  v_missed  integer := 0;
  v_expired integer := 0;
BEGIN
  -- Walk-ins: an hour after the code was made (or at closing, if sooner).
  UPDATE orders x
     SET status = 'cancelled', skip_reason = 'walk_in_missed', updated_at = now()
    FROM pickup_locations l
   WHERE l.id = x.pickup_location_id
     AND x.walk_in
     AND x.status IN ('scheduled', 'confirmed', 'preparing')
     AND (x.created_at <= now() - interval '1 hour'
          OR x.delivery_date < v_today
          OR (x.delivery_date = v_today AND v_now >= l.closes_at));
  GET DIAGNOSTICS v_missed = ROW_COUNT;

  -- Missed ones nobody answered in 7 days: not collected, never charged.
  UPDATE orders
     SET skip_reason = 'walk_in_expired', updated_at = now()
   WHERE walk_in AND status = 'cancelled' AND skip_reason = 'walk_in_missed'
     AND delivery_date < v_today - 7;
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  -- Booked before 087, never collected: charged like a delivery (unchanged).
  FOR o IN
    SELECT x.id, x.user_id, x.meal_slot, x.delivery_date, l.name AS place
      FROM orders x JOIN pickup_locations l ON l.id = x.pickup_location_id
     WHERE x.fulfilment <> 'delivery' AND NOT x.walk_in
       AND x.status IN ('scheduled', 'confirmed', 'preparing')
       AND (x.delivery_date < v_today
            OR (x.delivery_date = v_today
                AND v_now >= CASE WHEN x.meal_slot = 'dinner' THEN l.closes_at ELSE l.lunch_until END))
     ORDER BY x.delivery_date, x.meal_slot
  LOOP
    res := advance_order_delivered(o.id);
    IF res->>'result' = 'billed' THEN
      UPDATE orders SET pickup_missed = true WHERE id = o.id;
      PERFORM notify_event(o.user_id, 'pickup_missed', jsonb_build_object(
        'slot', o.meal_slot, 'place', o.place, 'date', to_char(o.delivery_date, 'Dy FMDD Mon')));
      v_billed := v_billed + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('missed_billed', v_billed, 'walk_ins_missed', v_missed, 'missed_expired', v_expired);
END; $$;
REVOKE ALL ON FUNCTION public.settle_pickups() FROM PUBLIC, anon, authenticated;

DO $cron$
BEGIN
  PERFORM cron.unschedule('gf-settle-pickups');
EXCEPTION WHEN OTHERS THEN NULL;
END $cron$;
SELECT cron.schedule('gf-settle-pickups', '*/5 * * * *', 'SELECT public.settle_pickups()');

-- Walk-ins that lapsed in the last 7 days under the old rule: missed, so they
-- can still be marked served.
UPDATE orders
   SET skip_reason = 'walk_in_missed', updated_at = now()
 WHERE walk_in AND status = 'cancelled' AND skip_reason = 'walk_in_expired'
   AND delivery_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date - 7;

-- ── Today's walk-in: + valid_until (an hour, or closing if sooner) ──────────
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
           'valid_until', to_char(LEAST((h.created_at AT TIME ZONE 'Asia/Kolkata') + interval '1 hour',
                                        (h.delivery_date + l.closes_at)), 'FMHH12:MI AM'),
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

-- ── Mark a missed walk-in served (charge it) ────────────────────────────────
-- The whole cart under that code, as ordered. The wallet must cover it.
CREATE OR REPLACE FUNCTION public.admin_charge_missed_walk_in(
  p_order uuid, p_reason text, p_admin uuid, p_action uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  o       record;
  r       record;
  res     jsonb;
  v_ids   uuid[];
  v_total integer := 0;
  v_bal   integer;
BEGIN
  PERFORM money_set_admin(p_admin, p_action);
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'Say what happened (e.g. who handed it over).'; END IF;

  SELECT id, user_id, delivery_date, pickup_location_id, pickup_code, walk_in, status, skip_reason
    INTO o FROM orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND OR NOT o.walk_in THEN RAISE EXCEPTION 'That isn''t a walk-in.'; END IF;
  IF o.status <> 'cancelled' OR o.skip_reason IS DISTINCT FROM 'walk_in_missed' THEN
    RAISE EXCEPTION 'That walk-in isn''t in Missed walk-ins any more.';
  END IF;
  IF o.delivery_date < v_today - 7 THEN RAISE EXCEPTION 'Missed walk-ins can be marked for 7 days.'; END IF;

  SELECT array_agg(x.id ORDER BY x.slot_seq) INTO v_ids
    FROM orders x
   WHERE x.user_id = o.user_id AND x.delivery_date = o.delivery_date AND x.walk_in
     AND x.pickup_location_id = o.pickup_location_id
     AND x.pickup_code IS NOT DISTINCT FROM o.pickup_code
     AND x.status = 'cancelled' AND x.skip_reason = 'walk_in_missed';

  -- Back to open (the status change is what advance_order_delivered bills).
  UPDATE orders SET status = 'confirmed', skip_reason = NULL,
                    office_note = 'Marked served later: ' || trim(p_reason), updated_at = now()
   WHERE id = ANY (v_ids);
  FOR r IN SELECT unnest(v_ids) AS id LOOP
    v_total := v_total + recompute_order_cart(r.id);
  END LOOP;

  SELECT COALESCE(balance, 0) INTO v_bal FROM wallets WHERE user_id = o.user_id FOR UPDATE;
  IF COALESCE(v_bal, 0) < v_total THEN
    RAISE EXCEPTION 'Their wallet has %, and this walk-in costs %. Add paid meals first, then mark it served.',
      fmt_rupees(COALESCE(v_bal, 0)), fmt_rupees(v_total);
  END IF;

  FOR r IN SELECT unnest(v_ids) AS id LOOP
    res := advance_order_delivered(r.id);
    IF res->>'result' <> 'billed' THEN
      RAISE EXCEPTION 'Could not charge it (%). Nothing was changed.', res->>'result';
    END IF;
  END LOOP;
  -- Handed over on its own day; the exact time isn't known.
  UPDATE orders SET collected_at = NULL,
                    delivered_at = CASE WHEN delivery_date = v_today THEN delivered_at END
   WHERE id = ANY (v_ids);

  RETURN jsonb_build_object('total', v_total, 'items', array_length(v_ids, 1), 'user_id', o.user_id);
END; $$;
REVOKE ALL ON FUNCTION public.admin_charge_missed_walk_in(uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_charge_missed_walk_in(uuid, text, uuid, uuid) TO service_role;

-- ── Not served: take it off the list ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_dismiss_missed_walk_in(p_order uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o record;
  n integer;
BEGIN
  SELECT user_id, delivery_date, pickup_location_id, pickup_code INTO o
    FROM orders WHERE id = p_order AND walk_in AND status = 'cancelled' AND skip_reason = 'walk_in_missed';
  IF NOT FOUND THEN RAISE EXCEPTION 'That walk-in isn''t in Missed walk-ins any more.'; END IF;
  UPDATE orders SET skip_reason = 'walk_in_expired', updated_at = now()
   WHERE user_id = o.user_id AND delivery_date = o.delivery_date AND walk_in
     AND pickup_location_id = o.pickup_location_id AND pickup_code IS NOT DISTINCT FROM o.pickup_code
     AND status = 'cancelled' AND skip_reason = 'walk_in_missed';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $$;
REVOKE ALL ON FUNCTION public.admin_dismiss_missed_walk_in(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_dismiss_missed_walk_in(uuid) TO service_role;
