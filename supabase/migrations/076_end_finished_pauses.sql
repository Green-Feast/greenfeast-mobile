-- ============================================================
-- GreenFeast — Migration 076: pauses start and end by themselves
-- ============================================================
-- Ops, 2 Nov. A pause only ever set status 'paused', at the moment it was asked
-- for, and nothing cleared it:
-- 1. Past pause_until the plan stayed Paused until someone pressed Resume. Meals
--    made before the pause still went out while the app and admin said Paused,
--    and the 1 AM order run only makes meals for active plans, so no new ones
--    came after those.
-- 2. A pause set for later said Paused straight away, and the order run stopped
--    for the days before it too.
-- A plan is now 'active' until its first paused day (the dates alone mark a pause
-- to come). Nightly at 00:05 IST, before the 1 AM run, sync_pauses() starts the
-- ones due and ends the finished ones the way Resume does. Also run once now.
-- 3. The evening a pause ends the customer is told when meals restart, since
--    they now restart with nobody pressing anything.

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

INSERT INTO public.notification_templates
  (key, sort_order, label, description, placeholders, title, body, default_title, default_body, enabled)
VALUES
  ('pause_ending', 168, 'Pause ends today, meals restart',
   'Sent at 6 PM on the last day of a pause, with the day meals restart.',
   '{name,when}',
   'Your meals restart {when}',
   'Your pause ends today. Need a longer break? In Plan & settings, tap Resume, then Pause with your new dates.',
   'Your meals restart {when}',
   'Your pause ends today. Need a longer break? In Plan & settings, tap Resume, then Pause with your new dates.',
   true)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.remind_pause_ending()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  s       record;
  v_day   date;
  v_next  date;
  n       integer := 0;
BEGIN
  FOR s IN
    SELECT id, user_id, meals_lunch, meals_dinner
      FROM subscriptions
     WHERE status = 'paused' AND pause_until = v_today AND deliveries_remaining > 0
  LOOP
    -- The first day the order run can use: not Sunday, one of the plan's
    -- delivery days if it has any, and with a slot of theirs not closed.
    v_next := NULL;
    FOR v_day IN SELECT generate_series(v_today + 1, v_today + 14, interval '1 day')::date LOOP
      CONTINUE WHEN EXTRACT(DOW FROM v_day) = 0;
      CONTINUE WHEN EXISTS (SELECT 1 FROM subscription_schedule x WHERE x.subscription_id = s.id)
        AND NOT EXISTS (SELECT 1 FROM subscription_schedule x
                         WHERE x.subscription_id = s.id AND x.day_of_week = to_char(v_day, 'Dy'));
      CONTINUE WHEN NOT (
        (COALESCE(s.meals_lunch, 0) > 0 AND NOT EXISTS (SELECT 1 FROM kitchen_closures c WHERE c.closed_on = v_day AND c.meal_slot = 'lunch'))
        OR (COALESCE(s.meals_dinner, 0) > 0 AND NOT EXISTS (SELECT 1 FROM kitchen_closures c WHERE c.closed_on = v_day AND c.meal_slot = 'dinner')));
      v_next := v_day;
      EXIT;
    END LOOP;
    CONTINUE WHEN v_next IS NULL;

    PERFORM notify_event(s.user_id, 'pause_ending', jsonb_build_object(
      'when', CASE v_next WHEN v_today + 1 THEN 'tomorrow' ELSE 'on ' || to_char(v_next, 'Dy FMDD Mon') END
    ), 'order_update');
    n := n + 1;
  END LOOP;
  RETURN n;
END; $$;
REVOKE ALL ON FUNCTION public.remind_pause_ending() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('gf-sync-pauses') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gf-sync-pauses');
SELECT cron.schedule('gf-sync-pauses', '35 18 * * *', $$SELECT public.sync_pauses()$$);
SELECT cron.unschedule('gf-pause-ending') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gf-pause-ending');
SELECT cron.schedule('gf-pause-ending', '30 12 * * *', $$SELECT public.remind_pause_ending()$$);

SELECT public.sync_pauses();
