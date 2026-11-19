-- 098: Pause is for deliveries only.
--
-- A pause stops deliveries; walk-ins (087) stay open the whole time
-- (todays_walk_in / start_walk_in already accept a paused plan). The daily
-- sync_pauses job, though, cancelled every open order on a pause day that had
-- come round, walk-ins included. Now it touches deliveries only, and the
-- resume step only brings back deliveries. The app calls it "Pause deliveries".

CREATE OR REPLACE FUNCTION public.sync_pauses()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today   date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_ended   uuid[];
  v_started integer;
  v_later   integer;
BEGIN
  WITH ended AS (
    UPDATE subscriptions
       SET status = 'active', pause_from = NULL, pause_until = NULL, updated_at = now()
     WHERE status IN ('active', 'paused') AND pause_until < v_today
     RETURNING id
  )
  SELECT array_agg(id) INTO v_ended FROM ended;

  -- The pause's own cancellations come back, as on Resume.
  UPDATE orders o
     SET status = 'scheduled', skip_reason = NULL, updated_at = now()
   WHERE o.subscription_id = ANY (COALESCE(v_ended, '{}'))
     AND o.delivery_date >= v_today
     AND o.status = 'cancelled'
     AND (o.skip_reason = 'pause' OR (o.skip_reason IS NULL AND o.extra_dish = false))
     AND NOT o.walk_in
     AND NOT is_slot_locked(o.delivery_date, o.meal_slot);

  -- A pause set for later that has come round. Anything added to its days since
  -- it was set goes with it.
  UPDATE orders o
     SET status = 'cancelled', skip_reason = 'pause', updated_at = now()
    FROM subscriptions s
   WHERE s.id = o.subscription_id
     AND s.status = 'active' AND s.pause_from <= v_today AND s.pause_until >= v_today
     AND o.delivery_date BETWEEN s.pause_from AND s.pause_until
     AND o.status IN ('scheduled', 'confirmed')
     AND NOT o.walk_in
     AND NOT is_slot_locked(o.delivery_date, o.meal_slot);

  UPDATE subscriptions
     SET status = 'paused', updated_at = now()
   WHERE status = 'active' AND pause_from <= v_today AND pause_until >= v_today;
  GET DIAGNOSTICS v_started = ROW_COUNT;

  -- Older ones were marked Paused from the day they were asked for.
  UPDATE subscriptions
     SET status = 'active', updated_at = now()
   WHERE status = 'paused' AND pause_from > v_today;
  GET DIAGNOSTICS v_later = ROW_COUNT;

  RETURN jsonb_build_object('ended', COALESCE(array_length(v_ended, 1), 0), 'started', v_started, 'set_for_later', v_later);
END; $$;
REVOKE ALL ON FUNCTION public.sync_pauses() FROM PUBLIC, anon, authenticated;

UPDATE public.notification_templates
   SET body = 'Your delivery pause ends today. Need a longer break? In Plan Settings, tap Resume deliveries, then Pause deliveries with your new dates.',
       default_body = 'Your delivery pause ends today. Need a longer break? In Plan Settings, tap Resume deliveries, then Pause deliveries with your new dates.'
 WHERE key = 'pause_ending'
   AND body = 'Your pause ends today. Need a longer break? In Plan & settings, tap Resume, then Pause with your new dates.';
