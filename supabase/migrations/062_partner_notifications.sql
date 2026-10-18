-- ============================================================
-- GreenFeast — Migration 062: delivery partner notifications + language
-- ============================================================
-- The GreenFeast Partner app (greenfeast-delivery-partner) now speaks
-- English, Hindi or Hinglish and gets notifications — a push on the phone
-- (Expo, like the customer app's notify_user) plus a list under the bell:
--   run_reminder          11:00 / 16:00 IST: today's stops, meals, cash
--   office_message        typed by the office in the admin
--   stop_added / stop_cancelled / stop_moved_away / stop_address_changed
--                         today's list changed after the slot's cutoff
--   drop_delivered / drop_skipped     the office settled a failed drop
--   cash_recorded / cash_dismissed    the office dealt with a cash report
-- Texts live in partner_text() in all three languages and follow the
-- partner's chosen language (set from the app).
-- ============================================================

ALTER TABLE public.delivery_partners
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS expo_push_token text;
ALTER TABLE public.delivery_partners DROP CONSTRAINT IF EXISTS delivery_partners_language_check;
ALTER TABLE public.delivery_partners ADD CONSTRAINT delivery_partners_language_check CHECK (language IN ('en', 'hi', 'hinglish'));

CREATE TABLE IF NOT EXISTS public.partner_notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.delivery_partners(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  title      text NOT NULL,
  body       text NOT NULL,
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  read       boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_notifications_partner ON public.partner_notifications (partner_id, created_at DESC);
ALTER TABLE public.partner_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_notifications FROM anon, authenticated;
GRANT ALL ON public.partner_notifications TO service_role;

-- ₹7,200 / ₹1,20,000
CREATE OR REPLACE FUNCTION public.inr(p_paise bigint)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT '₹' || btrim(to_char(round(COALESCE(p_paise, 0) / 100.0), 'FM99,99,99,99,990'));
$$;

-- ── The texts, in English / Hindi / Hinglish ───────────────────────────────
-- vars: slot ('lunch'|'dinner'), batch, name, address, stops, meals,
-- cash (paise), amount (text), message.
CREATE OR REPLACE FUNCTION public.partner_text(p_key text, p_lang text, p_vars jsonb, OUT title text, OUT body text)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  l      text := CASE WHEN p_lang IN ('hi', 'hinglish') THEN p_lang ELSE 'en' END;
  dinner boolean := COALESCE(p_vars ->> 'slot', 'lunch') = 'dinner';
  cash   bigint := COALESCE(NULLIF(p_vars ->> 'cash', '')::bigint, 0);
  v      jsonb;
BEGIN
  v := COALESCE(p_vars, '{}'::jsonb) || jsonb_build_object(
    'slot_word', CASE l WHEN 'hi' THEN CASE WHEN dinner THEN 'डिनर' ELSE 'लंच' END
                        ELSE CASE WHEN dinner THEN 'dinner' ELSE 'lunch' END END,
    'Slot_word', CASE l WHEN 'hi' THEN CASE WHEN dinner THEN 'डिनर' ELSE 'लंच' END
                        ELSE CASE WHEN dinner THEN 'Dinner' ELSE 'Lunch' END END,
    'cash_line', CASE WHEN cash <= 0 THEN ''
                      WHEN l = 'hi' THEN ' · ' || public.inr(cash) || ' कैश लेना है'
                      WHEN l = 'hinglish' THEN ' · ' || public.inr(cash) || ' cash lena hai'
                      ELSE ' · collect ' || public.inr(cash) || ' cash' END);

  CASE p_key || ':' || l
    WHEN 'run_reminder:en' THEN title := '{Slot_word} today: {batch}'; body := '{stops} stops · {meals} meals{cash_line}. Open the app to start.';
    WHEN 'run_reminder:hi' THEN title := 'आज का {slot_word}: {batch}'; body := '{stops} स्टॉप · {meals} मील{cash_line}। शुरू करने के लिए ऐप खोलें।';
    WHEN 'run_reminder:hinglish' THEN title := 'Aaj ka {slot_word}: {batch}'; body := '{stops} stops · {meals} meals{cash_line}. Shuru karne ke liye app kholo.';

    WHEN 'office_message:en' THEN title := 'Message from the office'; body := '{message}';
    WHEN 'office_message:hi' THEN title := 'ऑफिस से संदेश'; body := '{message}';
    WHEN 'office_message:hinglish' THEN title := 'Office se message'; body := '{message}';

    WHEN 'stop_added:en' THEN title := 'New stop in {batch}'; body := '{name}''s {slot_word} was added to your list.';
    WHEN 'stop_added:hi' THEN title := '{batch} में नया स्टॉप'; body := '{name} का {slot_word} आपकी लिस्ट में जोड़ा गया।';
    WHEN 'stop_added:hinglish' THEN title := '{batch} mein naya stop'; body := '{name} ka {slot_word} aapki list mein add hua.';

    WHEN 'stop_cancelled:en' THEN title := 'Stop cancelled'; body := '{name}''s {slot_word} is cancelled — don''t deliver it.';
    WHEN 'stop_cancelled:hi' THEN title := 'स्टॉप रद्द'; body := '{name} का {slot_word} रद्द हो गया — इसे डिलीवर न करें।';
    WHEN 'stop_cancelled:hinglish' THEN title := 'Stop cancel'; body := '{name} ka {slot_word} cancel ho gaya — deliver mat karna.';

    WHEN 'stop_moved_away:en' THEN title := 'Stop moved'; body := '{name}''s {slot_word} moved to another batch — it''s not on your list any more.';
    WHEN 'stop_moved_away:hi' THEN title := 'स्टॉप हटाया गया'; body := '{name} का {slot_word} दूसरे बैच में चला गया — अब आपकी लिस्ट में नहीं है।';
    WHEN 'stop_moved_away:hinglish' THEN title := 'Stop hata diya'; body := '{name} ka {slot_word} dusre batch mein gaya — ab aapki list mein nahi hai.';

    WHEN 'stop_address_changed:en' THEN title := 'Address changed'; body := 'New address for {name}''s {slot_word}: {address}';
    WHEN 'stop_address_changed:hi' THEN title := 'पता बदला'; body := '{name} के {slot_word} का नया पता: {address}';
    WHEN 'stop_address_changed:hinglish' THEN title := 'Address badla'; body := '{name} ke {slot_word} ka naya address: {address}';

    WHEN 'drop_delivered:en' THEN title := 'Office marked it delivered'; body := 'The office marked {name}''s {slot_word} as delivered.';
    WHEN 'drop_delivered:hi' THEN title := 'ऑफिस ने डिलीवर मार्क किया'; body := '{name} का {slot_word} ऑफिस ने डिलीवर मार्क कर दिया।';
    WHEN 'drop_delivered:hinglish' THEN title := 'Office ne delivered mark kiya'; body := '{name} ka {slot_word} office ne delivered mark kar diya.';

    WHEN 'drop_skipped:en' THEN title := 'Office skipped it'; body := '{name}''s {slot_word} won''t be delivered — the office skipped it.';
    WHEN 'drop_skipped:hi' THEN title := 'ऑफिस ने स्किप किया'; body := '{name} का {slot_word} डिलीवर नहीं होगा — ऑफिस ने स्किप कर दिया।';
    WHEN 'drop_skipped:hinglish' THEN title := 'Office ne skip kiya'; body := '{name} ka {slot_word} deliver nahi hoga — office ne skip kar diya.';

    WHEN 'cash_recorded:en' THEN title := 'Cash received'; body := 'The office recorded {amount} from {name}. Thank you!';
    WHEN 'cash_recorded:hi' THEN title := 'कैश मिल गया'; body := 'ऑफिस ने {name} के {amount} दर्ज कर लिए। धन्यवाद!';
    WHEN 'cash_recorded:hinglish' THEN title := 'Cash mil gaya'; body := 'Office ne {name} ke {amount} record kar liye. Thank you!';

    WHEN 'cash_dismissed:en' THEN title := 'Cash report not accepted'; body := 'The office didn''t accept your {amount} report for {name}. Please call the office.';
    WHEN 'cash_dismissed:hi' THEN title := 'कैश रिपोर्ट नहीं मानी गई'; body := '{name} के {amount} की आपकी रिपोर्ट ऑफिस ने नहीं मानी। कृपया ऑफिस को कॉल करें।';
    WHEN 'cash_dismissed:hinglish' THEN title := 'Cash report nahi mani'; body := '{name} ke {amount} ki report office ne nahi mani. Office ko call karo.';

    ELSE title := 'GreenFeast'; body := COALESCE(p_vars ->> 'message', '');
  END CASE;

  title := public.render_template(title, v);
  body := public.render_template(body, v);
END; $$;

-- ── Send one: in-app row + push, in the partner's language ─────────────────
CREATE OR REPLACE FUNCTION public.notify_partner(p_partner uuid, p_key text, p_vars jsonb DEFAULT '{}'::jsonb, p_data jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.delivery_partners;
  t record;
BEGIN
  SELECT * INTO p FROM public.delivery_partners WHERE id = p_partner;
  -- Only partners who can open the app.
  IF NOT FOUND OR p.status <> 'active' OR p.user_id IS NULL THEN
    RETURN;
  END IF;
  SELECT * INTO t FROM public.partner_text(p_key, p.language, p_vars);
  INSERT INTO public.partner_notifications (partner_id, kind, title, body, data)
  VALUES (p.id, p_key, t.title, t.body, COALESCE(p_data, '{}'::jsonb));
  IF COALESCE(p.expo_push_token, '') <> '' THEN
    PERFORM net.http_post(
      url     := 'https://exp.host/--/api/v2/push/send',
      body    := jsonb_build_object(
                   'to', p.expo_push_token, 'title', t.title, 'body', t.body,
                   'sound', 'default', 'channelId', 'deliveries', 'priority', 'high',
                   'data', COALESCE(p_data, '{}'::jsonb) || jsonb_build_object('kind', p_key)),
      headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb
    );
  END IF;
END; $$;

-- Every partner (main and backup) of a batch, in the given Live/Test world.
CREATE OR REPLACE FUNCTION public.notify_batch_partners(p_batch uuid, p_is_test boolean, p_key text, p_vars jsonb, p_data jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT dp.id
      FROM public.batches b
      JOIN public.delivery_partners dp ON dp.id IN (b.primary_partner_id, b.secondary_partner_id)
     WHERE b.id = p_batch AND dp.is_test = p_is_test
  LOOP
    PERFORM public.notify_partner(r.id, p_key, p_vars, p_data);
  END LOOP;
END; $$;

REVOKE ALL ON FUNCTION public.notify_partner(uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_batch_partners(uuid, boolean, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_partner(uuid, text, jsonb, jsonb) TO service_role;

-- ── Run reminder (pg_cron, 11:00 and 16:00 IST) ────────────────────────────
CREATE OR REPLACE FUNCTION public.partner_run_reminders(p_slot text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  r       record;
  n       integer := 0;
BEGIN
  FOR r IN
    WITH pp AS (
      SELECT b.id AS batch_id, btrim(b.name) AS batch_name, dp.id AS partner_id, dp.is_test
        FROM public.batches b
        JOIN public.delivery_partners dp ON dp.id IN (b.primary_partner_id, b.secondary_partner_id)
       WHERE b.meal_slot = p_slot AND dp.status = 'active' AND dp.user_id IS NOT NULL
    ), o AS (
      SELECT o.batch_id, COALESCE(o.address_id, o.id) AS stop_key, COALESCE(o.quantity, 1) AS qty,
             o.subscription_id, u.is_test
        FROM public.orders o
        JOIN public.users u ON u.id = o.user_id
       WHERE o.delivery_date = v_today AND o.meal_slot = p_slot
         AND o.status IN ('scheduled', 'confirmed', 'preparing')
    )
    SELECT pp.partner_id, pp.batch_id, pp.batch_name,
           count(DISTINCT o.stop_key) AS stops,
           sum(o.qty) AS meals,
           (SELECT COALESCE(sum(s.cod_due_paise), 0)
              FROM public.subscriptions s
             WHERE s.cod_due_paise > 0
               AND s.id IN (SELECT o2.subscription_id FROM o o2 WHERE o2.batch_id = pp.batch_id AND o2.is_test = pp.is_test)) AS cash
      FROM pp
      JOIN o ON o.batch_id = pp.batch_id AND o.is_test = pp.is_test
     GROUP BY pp.partner_id, pp.batch_id, pp.batch_name, pp.is_test
  LOOP
    PERFORM public.notify_partner(
      r.partner_id, 'run_reminder',
      jsonb_build_object('slot', p_slot, 'batch', r.batch_name, 'stops', r.stops, 'meals', r.meals, 'cash', r.cash),
      jsonb_build_object('batch_id', r.batch_id));
    n := n + 1;
  END LOOP;
  RETURN n;
END; $$;
REVOKE ALL ON FUNCTION public.partner_run_reminders(text) FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('gf-partner-reminder-lunch', '30 5 * * *', $$SELECT public.partner_run_reminders('lunch')$$);
SELECT cron.schedule('gf-partner-reminder-dinner', '30 10 * * *', $$SELECT public.partner_run_reminders('dinner')$$);

-- ── Today's list changed after the cutoff ──────────────────────────────────
-- Never blocks the order change itself: any error here is swallowed.
CREATE OR REPLACE FUNCTION public.orders_notify_partners()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      SELECT concat_ws(', ', NULLIF(btrim(line1), ''), NULLIF(btrim(landmark), '')) INTO v_addr
        FROM public.addresses WHERE id = NEW.address_id;
      PERFORM public.notify_batch_partners(NEW.batch_id, v_test, 'stop_address_changed',
        v_vars || jsonb_build_object('address', COALESCE(v_addr, '—')),
        jsonb_build_object('batch_id', NEW.batch_id));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'orders_notify_partners: %', SQLERRM;
  END;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS orders_notify_partners ON public.orders;
CREATE TRIGGER orders_notify_partners
  AFTER INSERT OR UPDATE OF status, batch_id, address_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_notify_partners();

-- ── App functions ──────────────────────────────────────────────────────────
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
  IF p.last_seen_at IS NULL OR p.last_seen_at < now() - interval '5 minutes' THEN
    UPDATE public.delivery_partners SET last_seen_at = now() WHERE id = p.id;
  END IF;
  RETURN jsonb_build_object(
    'id', p.id, 'name', p.name, 'phone', p.phone, 'is_test', p.is_test, 'language', p.language,
    'today', (now() AT TIME ZONE 'Asia/Kolkata')::date);
END; $$;

-- The phone's Expo push token (NULL on sign-out). A phone handed to another
-- partner stops getting the first one's pushes.
CREATE OR REPLACE FUNCTION public.partner_set_push_token(p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.delivery_partners;
  v text := NULLIF(btrim(COALESCE(p_token, '')), '');
BEGIN
  p := public.current_partner();
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'Not signed in as a delivery partner.' USING ERRCODE = '42501';
  END IF;
  IF v IS NOT NULL THEN
    UPDATE public.delivery_partners SET expo_push_token = NULL WHERE expo_push_token = v AND id <> p.id;
  END IF;
  UPDATE public.delivery_partners SET expo_push_token = v WHERE id = p.id;
END; $$;

CREATE OR REPLACE FUNCTION public.partner_set_language(p_lang text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.delivery_partners;
BEGIN
  p := public.current_partner();
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'Not signed in as a delivery partner.' USING ERRCODE = '42501';
  END IF;
  IF p_lang NOT IN ('en', 'hi', 'hinglish') THEN
    RAISE EXCEPTION 'Unknown language.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.delivery_partners SET language = p_lang WHERE id = p.id;
END; $$;

CREATE OR REPLACE FUNCTION public.partner_notifications(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.delivery_partners;
BEGIN
  p := public.current_partner();
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'Not signed in as a delivery partner.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'unread', (SELECT count(*) FROM public.partner_notifications WHERE partner_id = p.id AND NOT read),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body,
                                          'data', n.data, 'read', n.read, 'created_at', n.created_at)
                       ORDER BY n.created_at DESC)
        FROM (SELECT * FROM public.partner_notifications WHERE partner_id = p.id
               ORDER BY created_at DESC LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)) n
    ), '[]'::jsonb));
END; $$;

CREATE OR REPLACE FUNCTION public.partner_notifications_read()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.delivery_partners;
BEGIN
  p := public.current_partner();
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'Not signed in as a delivery partner.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.partner_notifications SET read = true WHERE partner_id = p.id AND NOT read;
END; $$;

REVOKE ALL ON FUNCTION public.partner_set_push_token(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_set_language(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_notifications(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_notifications_read() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_set_push_token(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partner_set_language(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partner_notifications(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partner_notifications_read() TO authenticated;
