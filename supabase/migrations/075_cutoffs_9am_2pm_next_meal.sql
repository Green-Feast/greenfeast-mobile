-- ============================================================
-- GreenFeast — Migration 075: cutoffs 9 AM / 2 PM; next-meal message
-- ============================================================
-- 1. Lunch now locks at 9 AM and dinner at 2 PM IST (were 8 AM / 1 PM), and
--    the wallet check at the cutoff moves with them.
-- 2. A customer who signs up or renews is told when their next meal is:
--    notify_next_meal(), called once the plan's orders exist (cashfree-webhook,
--    admin Create subscription / Activate plan). Once per plan — the webhook
--    can be retried.

CREATE OR REPLACE FUNCTION public.is_slot_locked(p_date date, p_slot text)
RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_today_ist date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_now_ist   time := (now() AT TIME ZONE 'Asia/Kolkata')::time;
  v_cutoff    time;
BEGIN
  IF p_date < v_today_ist THEN RETURN true; END IF;
  IF p_date > v_today_ist THEN RETURN false; END IF;

  v_cutoff := CASE p_slot
    WHEN 'lunch'  THEN TIME '09:00'
    WHEN 'dinner' THEN TIME '14:00'
    ELSE TIME '00:00'  -- unknown slot: treat as locked from midnight, same-day
  END;
  RETURN v_now_ist >= v_cutoff;
END; $$;
GRANT EXECUTE ON FUNCTION public.is_slot_locked(date, text) TO anon, authenticated, service_role;

SELECT cron.schedule('gf-cutoff-balance-lunch',  '30 3 * * *', $$SELECT public.enforce_slot_balance('lunch')$$);
SELECT cron.schedule('gf-cutoff-balance-dinner', '30 8 * * *', $$SELECT public.enforce_slot_balance('dinner')$$);

UPDATE public.notification_templates SET body = replace(body, '8 AM', '9 AM') WHERE key = 'low_balance_warning';
UPDATE public.notification_templates SET default_body = replace(default_body, '8 AM', '9 AM') WHERE key = 'low_balance_warning';

ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS next_meal_notified_at timestamptz;

INSERT INTO public.notification_templates
  (key, sort_order, label, description, placeholders, title, body, default_title, default_body, enabled)
VALUES
  ('next_meal', 165, 'Next meal after signing up or renewing',
   'Sent once when a plan starts, as soon as its meals are scheduled.',
   '{name,slot,dish,when,cutoff}',
   'Your next meal is {slot} {when}',
   '{dish} is coming for {slot} {when}. You can skip or change it until {cutoff} that day.',
   'Your next meal is {slot} {when}',
   '{dish} is coming for {slot} {when}. You can skip or change it until {cutoff} that day.',
   true)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.notify_next_meal(p_sub uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_user  uuid;
  m       record;
BEGIN
  SELECT o.delivery_date, o.meal_slot, t.name AS dish INTO m
    FROM orders o JOIN meal_templates t ON t.id = o.meal_template_id
   WHERE o.subscription_id = p_sub
     AND o.status IN ('scheduled', 'confirmed')
     AND NOT is_slot_locked(o.delivery_date, o.meal_slot)
   ORDER BY o.delivery_date, CASE o.meal_slot WHEN 'lunch' THEN 0 ELSE 1 END, o.slot_seq
   LIMIT 1;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE subscriptions SET next_meal_notified_at = now()
   WHERE id = p_sub AND next_meal_notified_at IS NULL
   RETURNING user_id INTO v_user;
  IF v_user IS NULL THEN RETURN false; END IF;

  RETURN notify_event(v_user, 'next_meal', jsonb_build_object(
    'slot', m.meal_slot,
    'dish', m.dish,
    'when', CASE m.delivery_date
              WHEN v_today THEN 'today'
              WHEN v_today + 1 THEN 'tomorrow'
              ELSE 'on ' || to_char(m.delivery_date, 'Dy FMDD Mon') END,
    'cutoff', CASE m.meal_slot WHEN 'lunch' THEN '9 AM' ELSE '2 PM' END
  ), 'order_update');
END; $$;
REVOKE ALL ON FUNCTION public.notify_next_meal(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_next_meal(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
