-- ============================================================
-- GreenFeast — Migration 064: meal ratings and app feedback
-- ============================================================
-- Customers rate each delivered lunch / dinner on 1–5 stars (optional chips
-- and a comment) and can send feedback from Account. The admin sees all of it
-- on the Feedback page; a 1–2★ rating or new feedback alerts every admin
-- (real customers only, like migration 063).
--
-- A rating belongs to a customer + date + slot (a slot can be several order
-- rows: extra dishes, portions to another address). One meal_ratings row per
-- meal records that the customer was asked (the Home card was shown, or the
-- 3 PM / 9 PM push went), then the rating when they give it.
--
-- How often a customer is asked: feedback_settings.frequency (admin →
-- Feedback): every meal, once a day, once a week, or automatic (every meal
-- for the first auto_daily_after meals, then daily until auto_weekly_after,
-- then weekly). After a 1–2★ rating the next 3 meals are always asked.
-- ============================================================

-- ── Settings ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.feedback_settings (
  id                boolean PRIMARY KEY DEFAULT true CHECK (id),
  frequency         text NOT NULL DEFAULT 'every_meal'
                    CHECK (frequency IN ('every_meal', 'daily', 'weekly', 'auto')),
  auto_daily_after  integer NOT NULL DEFAULT 10 CHECK (auto_daily_after BETWEEN 0 AND 1000),
  auto_weekly_after integer NOT NULL DEFAULT 30 CHECK (auto_weekly_after BETWEEN 0 AND 1000),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        text,
  CHECK (auto_weekly_after >= auto_daily_after)
);
INSERT INTO public.feedback_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.feedback_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.feedback_settings FROM anon, authenticated;
GRANT ALL ON public.feedback_settings TO service_role;

-- ── Ratings ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.meal_ratings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  delivery_date       date NOT NULL,
  meal_slot           text NOT NULL CHECK (meal_slot IN ('lunch', 'dinner')),
  stars               smallint CHECK (stars BETWEEN 1 AND 5),       -- null: asked, not rated
  tags                text[] NOT NULL DEFAULT '{}',
  comment             text CHECK (char_length(comment) <= 1000),
  -- what was delivered, as it was then
  dish_ids            text[] NOT NULL DEFAULT '{}',
  dish_names          text NOT NULL DEFAULT '',
  order_ids           uuid[] NOT NULL DEFAULT '{}',
  subscription_id     uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  batch_id            uuid REFERENCES public.batches(id) ON DELETE SET NULL,
  delivery_partner_id uuid REFERENCES public.delivery_partners(id) ON DELETE SET NULL,
  -- app: Home card · push: 3 PM / 9 PM reminder · history: rated from Order history unasked
  source              text NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'push', 'history')),
  asked_at            timestamptz,
  pushed_at           timestamptz,
  rated_at            timestamptz,
  dismissed_at        timestamptz,
  -- office follow-up
  handled_at          timestamptz,
  handled_by          text,
  admin_note          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, delivery_date, meal_slot)
);
CREATE INDEX IF NOT EXISTS meal_ratings_rated ON public.meal_ratings (rated_at DESC) WHERE stars IS NOT NULL;
CREATE INDEX IF NOT EXISTS meal_ratings_follow_up ON public.meal_ratings (rated_at) WHERE stars <= 2 AND handled_at IS NULL;
ALTER TABLE public.meal_ratings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meal_ratings FROM anon, authenticated;
-- Own rows (policy), for Order history — not the office's follow-up columns.
GRANT SELECT (id, delivery_date, meal_slot, stars, tags, comment, dish_names, rated_at)
  ON public.meal_ratings TO authenticated;
GRANT ALL ON public.meal_ratings TO service_role;
DROP POLICY IF EXISTS meal_ratings_select_own ON public.meal_ratings;
CREATE POLICY meal_ratings_select_own ON public.meal_ratings
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS meal_ratings_updated_at ON public.meal_ratings;
CREATE TRIGGER meal_ratings_updated_at BEFORE UPDATE ON public.meal_ratings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── App feedback (Account → Send feedback) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind        text NOT NULL DEFAULT 'other' CHECK (kind IN ('idea', 'problem', 'praise', 'other')),
  message     text NOT NULL CHECK (char_length(btrim(message)) BETWEEN 1 AND 2000),
  app_version text,
  platform    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  handled_at  timestamptz,
  handled_by  text,
  admin_note  text
);
CREATE INDEX IF NOT EXISTS app_feedback_recent ON public.app_feedback (created_at DESC);
ALTER TABLE public.app_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_feedback FROM anon, authenticated;
GRANT ALL ON public.app_feedback TO service_role;

-- ── Helpers ─────────────────────────────────────────────────────────────────
-- lunch before dinner on the same day
CREATE OR REPLACE FUNCTION public.meal_slot_rank(p_slot text)
RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_slot WHEN 'lunch' THEN 0 WHEN 'dinner' THEN 1 ELSE 2 END
$$;

-- The chips a customer can pick (labels live in the app and the admin).
--   1–3★ "What went wrong?": taste portion cold late packaging wrong_item oily_spicy not_fresh
--   4–5★ "What did you like?": taste portion fresh on_time packaging healthy value
CREATE OR REPLACE FUNCTION public.rating_tag_keys()
RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['taste', 'portion', 'cold', 'late', 'packaging', 'wrong_item', 'oily_spicy', 'not_fresh',
               'fresh', 'on_time', 'healthy', 'value']
$$;

-- Label for the admin alert (alerts are for 1–2★, so the "went wrong" wording).
CREATE OR REPLACE FUNCTION public.rating_tag_label(p_tag text)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_tag
    WHEN 'taste'      THEN 'Taste'
    WHEN 'portion'    THEN 'Portion size'
    WHEN 'cold'       THEN 'Cold'
    WHEN 'late'       THEN 'Late'
    WHEN 'packaging'  THEN 'Spilled / packaging'
    WHEN 'wrong_item' THEN 'Wrong or missing item'
    WHEN 'oily_spicy' THEN 'Too oily / spicy'
    WHEN 'not_fresh'  THEN 'Not fresh'
    WHEN 'fresh'      THEN 'Fresh'
    WHEN 'on_time'    THEN 'On time'
    WHEN 'healthy'    THEN 'Healthy'
    WHEN 'value'      THEN 'Value for money'
    ELSE p_tag END
$$;

-- What was delivered to a customer for a date + slot (delivered rows only).
-- snap_order_ids is null when nothing in that slot was delivered.
CREATE OR REPLACE FUNCTION public.meal_rating_snapshot(p_user uuid, p_date date, p_slot text)
RETURNS TABLE (snap_dish_ids text[], snap_dish_names text, snap_order_ids uuid[], snap_subscription_id uuid,
               snap_batch_id uuid, snap_partner_id uuid, snap_delivered_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(DISTINCT o.meal_template_id) FILTER (WHERE o.meal_template_id IS NOT NULL), '{}'),
         COALESCE(string_agg(DISTINCT btrim(mt.name), ' + '), ''),
         array_agg(o.id ORDER BY o.extra_dish, o.slot_seq),
         (array_agg(o.subscription_id ORDER BY o.extra_dish, o.slot_seq))[1],
         (array_agg(o.batch_id ORDER BY o.extra_dish, o.slot_seq) FILTER (WHERE o.batch_id IS NOT NULL))[1],
         (array_agg(o.delivery_partner_id ORDER BY o.extra_dish, o.slot_seq) FILTER (WHERE o.delivery_partner_id IS NOT NULL))[1],
         max(o.delivered_at)
    FROM public.orders o
    LEFT JOIN public.meal_templates mt ON mt.id = o.meal_template_id
   WHERE o.user_id = p_user AND o.delivery_date = p_date AND o.meal_slot = p_slot AND o.status = 'delivered'
$$;
REVOKE ALL ON FUNCTION public.meal_rating_snapshot(uuid, date, text) FROM PUBLIC, anon, authenticated;

-- May this meal be asked about, under the current setting?
CREATE OR REPLACE FUNCTION public.rating_can_ask(p_user uuid, p_date date, p_slot text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s      public.feedback_settings%ROWTYPE;
  v_mode text;
  v_n    integer;
BEGIN
  SELECT * INTO s FROM public.feedback_settings WHERE id;
  v_mode := COALESCE(s.frequency, 'every_meal');

  -- After a 1–2★ rating the next 3 meals are always asked (did the fix work?).
  IF EXISTS (
    SELECT 1 FROM public.meal_ratings r
     WHERE r.user_id = p_user AND r.stars <= 2
       AND (r.delivery_date, meal_slot_rank(r.meal_slot)) < (p_date, meal_slot_rank(p_slot))
       AND (SELECT count(*) FROM (
              SELECT DISTINCT o.delivery_date, o.meal_slot FROM public.orders o
               WHERE o.user_id = p_user AND o.status = 'delivered'
                 AND (o.delivery_date, meal_slot_rank(o.meal_slot)) > (r.delivery_date, meal_slot_rank(r.meal_slot))
                 AND (o.delivery_date, meal_slot_rank(o.meal_slot)) < (p_date, meal_slot_rank(p_slot))
            ) between_meals) < 3
  ) THEN
    RETURN true;
  END IF;

  -- Automatic: by how many meals this customer has had (this one included).
  IF v_mode = 'auto' THEN
    SELECT count(*) INTO v_n FROM (
      SELECT DISTINCT o.delivery_date, o.meal_slot FROM public.orders o
       WHERE o.user_id = p_user AND o.status = 'delivered'
         AND (o.delivery_date, meal_slot_rank(o.meal_slot)) <= (p_date, meal_slot_rank(p_slot))
    ) meals;
    v_mode := CASE WHEN v_n <= s.auto_daily_after THEN 'every_meal'
                   WHEN v_n <= s.auto_weekly_after THEN 'daily'
                   ELSE 'weekly' END;
  END IF;

  IF v_mode = 'every_meal' THEN
    RETURN true;
  ELSIF v_mode = 'daily' THEN
    -- at most one meal per delivery day
    RETURN NOT EXISTS (
      SELECT 1 FROM public.meal_ratings r
       WHERE r.user_id = p_user AND r.asked_at IS NOT NULL
         AND r.delivery_date = p_date AND r.meal_slot <> p_slot);
  ELSE
    -- weekly: at most one meal in any 7 days
    RETURN NOT EXISTS (
      SELECT 1 FROM public.meal_ratings r
       WHERE r.user_id = p_user AND r.asked_at IS NOT NULL
         AND r.delivery_date > p_date - 7 AND r.delivery_date <= p_date
         AND NOT (r.delivery_date = p_date AND r.meal_slot = p_slot));
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.rating_can_ask(uuid, date, text) FROM PUBLIC, anon, authenticated;

-- Ask about a delivered meal: record it (with what was delivered) if it isn't
-- recorded yet and the setting allows. Returns the new row's id, else null.
CREATE OR REPLACE FUNCTION public.rating_open_ask(p_user uuid, p_date date, p_slot text, p_source text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  snap record;
  v_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.meal_ratings
              WHERE user_id = p_user AND delivery_date = p_date AND meal_slot = p_slot) THEN
    RETURN NULL;
  END IF;
  SELECT * INTO snap FROM public.meal_rating_snapshot(p_user, p_date, p_slot);
  IF snap.snap_order_ids IS NULL THEN
    RETURN NULL;                                   -- nothing delivered
  END IF;
  IF NOT public.rating_can_ask(p_user, p_date, p_slot) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.meal_ratings
    (user_id, delivery_date, meal_slot, source, asked_at,
     dish_ids, dish_names, order_ids, subscription_id, batch_id, delivery_partner_id)
  VALUES
    (p_user, p_date, p_slot, p_source, now(),
     snap.snap_dish_ids, snap.snap_dish_names, snap.snap_order_ids, snap.snap_subscription_id,
     snap.snap_batch_id, snap.snap_partner_id)
  ON CONFLICT (user_id, delivery_date, meal_slot) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.rating_open_ask(uuid, date, text, text) FROM PUBLIC, anon, authenticated;

-- ── Customer app ─────────────────────────────────────────────────────────────
-- The meal the Home card asks about, or null: an open ask from the last 24
-- hours, else the newest meal delivered in the last 24 hours if the setting
-- allows asking about it (this records the ask).
CREATE OR REPLACE FUNCTION public.my_rating_prompt()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  r     public.meal_ratings%ROWTYPE;
  m     record;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT mr.* INTO r
    FROM public.meal_ratings mr
   WHERE mr.user_id = v_uid AND mr.asked_at IS NOT NULL AND mr.stars IS NULL AND mr.dismissed_at IS NULL
     AND EXISTS (SELECT 1 FROM public.orders o
                  WHERE o.id = ANY (mr.order_ids) AND o.delivered_at > now() - interval '24 hours')
   ORDER BY mr.delivery_date DESC, meal_slot_rank(mr.meal_slot) DESC
   LIMIT 1;

  IF r.id IS NULL THEN
    SELECT o.delivery_date, o.meal_slot INTO m
      FROM public.orders o
     WHERE o.user_id = v_uid AND o.status = 'delivered' AND o.delivered_at > now() - interval '24 hours'
       AND NOT EXISTS (SELECT 1 FROM public.meal_ratings x
                        WHERE x.user_id = v_uid AND x.delivery_date = o.delivery_date AND x.meal_slot = o.meal_slot)
     GROUP BY o.delivery_date, o.meal_slot
     ORDER BY o.delivery_date DESC, meal_slot_rank(o.meal_slot) DESC
     LIMIT 1;
    IF FOUND AND public.rating_open_ask(v_uid, m.delivery_date, m.meal_slot, 'app') IS NOT NULL THEN
      SELECT * INTO r FROM public.meal_ratings
       WHERE user_id = v_uid AND delivery_date = m.delivery_date AND meal_slot = m.meal_slot;
    END IF;
  END IF;

  IF r.id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'date', r.delivery_date,
    'slot', r.meal_slot,
    'dish_names', r.dish_names,
    'dishes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', mt.id, 'name', mt.name,
                                          'image', COALESCE(mt.thumb_url, mt.image_url)) ORDER BY mt.name)
        FROM public.meal_templates mt WHERE mt.id = ANY (r.dish_ids)), '[]'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.my_rating_prompt() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_rating_prompt() TO authenticated;

-- Rate (or re-rate) one of your delivered meals from the last 7 days.
CREATE OR REPLACE FUNCTION public.rate_meal(
  p_date date, p_slot text, p_stars integer, p_tags text[] DEFAULT '{}', p_comment text DEFAULT NULL,
  p_source text DEFAULT 'app'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_today   date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_tags    text[];
  v_comment text;
  v_source  text := CASE WHEN p_source IN ('app', 'push', 'history') THEN p_source ELSE 'app' END;
  snap      record;
  v_id      uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Please sign in again.';
  END IF;
  IF p_slot IS NULL OR p_slot NOT IN ('lunch', 'dinner') THEN
    RAISE EXCEPTION 'Unknown meal.';
  END IF;
  IF p_stars IS NULL OR p_stars NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Pick 1 to 5 stars.';
  END IF;
  IF p_date IS NULL OR p_date > v_today OR p_date < v_today - 7 THEN
    RAISE EXCEPTION 'Meals can be rated for 7 days after delivery.';
  END IF;
  SELECT * INTO snap FROM public.meal_rating_snapshot(v_uid, p_date, p_slot);
  IF snap.snap_order_ids IS NULL THEN
    RAISE EXCEPTION 'You can rate this meal once it has been delivered.';
  END IF;

  -- each chip once, in the order they were tapped
  v_tags := ARRAY(SELECT u.t FROM unnest(COALESCE(p_tags, '{}'::text[])) WITH ORDINALITY u(t, ord)
                   WHERE u.t IS NOT NULL AND u.t <> '' GROUP BY u.t ORDER BY min(u.ord));
  IF NOT (v_tags <@ public.rating_tag_keys()) THEN
    RAISE EXCEPTION 'Unknown option — please update the app.';
  END IF;
  v_comment := NULLIF(btrim(COALESCE(p_comment, '')), '');
  IF char_length(v_comment) > 1000 THEN
    RAISE EXCEPTION 'Please keep the comment under 1000 characters.';
  END IF;

  INSERT INTO public.meal_ratings
    (user_id, delivery_date, meal_slot, stars, tags, comment, rated_at, source,
     dish_ids, dish_names, order_ids, subscription_id, batch_id, delivery_partner_id)
  VALUES
    (v_uid, p_date, p_slot, p_stars, v_tags, v_comment, now(), v_source,
     snap.snap_dish_ids, snap.snap_dish_names, snap.snap_order_ids, snap.snap_subscription_id,
     snap.snap_batch_id, snap.snap_partner_id)
  ON CONFLICT (user_id, delivery_date, meal_slot) DO UPDATE
     SET stars = EXCLUDED.stars, tags = EXCLUDED.tags, comment = EXCLUDED.comment, rated_at = now()
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'stars', p_stars);
END; $$;
REVOKE ALL ON FUNCTION public.rate_meal(date, text, integer, text[], text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rate_meal(date, text, integer, text[], text, text) TO authenticated;

-- "Not now" on the Home card (still counts as asked).
CREATE OR REPLACE FUNCTION public.dismiss_rating_prompt(p_date date, p_slot text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.meal_ratings SET dismissed_at = now()
   WHERE user_id = auth.uid() AND delivery_date = p_date AND meal_slot = p_slot
     AND stars IS NULL AND dismissed_at IS NULL
$$;
REVOKE ALL ON FUNCTION public.dismiss_rating_prompt(date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_rating_prompt(date, text) TO authenticated;

-- Account → Send feedback.
CREATE OR REPLACE FUNCTION public.send_app_feedback(
  p_kind text, p_message text, p_app_version text DEFAULT NULL, p_platform text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_msg text := btrim(COALESCE(p_message, ''));
  v_id  uuid;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_uid) THEN
    RAISE EXCEPTION 'Please sign in again.';
  END IF;
  IF v_msg = '' THEN
    RAISE EXCEPTION 'Please write a message.';
  END IF;
  IF char_length(v_msg) > 2000 THEN
    RAISE EXCEPTION 'Please keep it under 2000 characters.';
  END IF;
  IF (SELECT count(*) FROM public.app_feedback
       WHERE user_id = v_uid AND created_at > now() - interval '1 day') >= 10 THEN
    RAISE EXCEPTION 'Thanks — we''ve got a lot from you today. Please message us on WhatsApp if it''s urgent.';
  END IF;
  INSERT INTO public.app_feedback (user_id, kind, message, app_version, platform)
  VALUES (v_uid,
          CASE WHEN p_kind IN ('idea', 'problem', 'praise', 'other') THEN p_kind ELSE 'other' END,
          v_msg, left(p_app_version, 40), left(p_platform, 20))
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.send_app_feedback(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_app_feedback(text, text, text, text) TO authenticated;

-- ── 3 PM / 9 PM reminder ────────────────────────────────────────────────────
-- Today's delivered meals in this slot that the customer hasn't been asked
-- about yet (e.g. they never opened the app): record the ask, and push
-- "How was your lunch?" — tapping it opens the rating sheet. No bell row.
-- Only while the rate_meal message is switched on.
CREATE OR REPLACE FUNCTION public.send_rating_asks(p_slot text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t       public.notification_templates%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  m       record;
  v_id    uuid;
  v_token text;
  v_name  text;
  v_dish  text;
  v_vars  jsonb;
  v_sent  integer := 0;
BEGIN
  SELECT * INTO t FROM public.notification_templates WHERE key = 'rate_meal';
  IF NOT FOUND OR NOT t.enabled THEN
    RETURN 0;
  END IF;

  FOR m IN
    SELECT o.user_id
      FROM public.orders o
     WHERE o.delivery_date = v_today AND o.meal_slot = p_slot AND o.status = 'delivered'
       AND NOT EXISTS (SELECT 1 FROM public.meal_ratings r
                        WHERE r.user_id = o.user_id AND r.delivery_date = v_today AND r.meal_slot = p_slot)
     GROUP BY o.user_id
  LOOP
    BEGIN
      v_id := public.rating_open_ask(m.user_id, v_today, p_slot, 'push');
      CONTINUE WHEN v_id IS NULL;
      SELECT u.expo_push_token, split_part(NULLIF(btrim(u.name), ''), ' ', 1)
        INTO v_token, v_name FROM public.users u WHERE u.id = m.user_id;
      CONTINUE WHEN COALESCE(v_token, '') = '';
      SELECT dish_names INTO v_dish FROM public.meal_ratings WHERE id = v_id;
      v_vars := jsonb_build_object('name', COALESCE(NULLIF(v_name, ''), 'there'),
                                   'slot', p_slot,
                                   'dish', COALESCE(NULLIF(v_dish, ''), p_slot));
      PERFORM net.http_post(
        url     := 'https://exp.host/--/api/v2/push/send',
        body    := jsonb_build_object(
                     'to', v_token,
                     'title', render_template(t.title, v_vars),
                     'body', render_template(t.body, v_vars),
                     'sound', 'default', 'channelId', 'default',
                     'data', jsonb_build_object('type', 'rate_meal', 'date', v_today, 'slot', p_slot)),
        headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb
      );
      UPDATE public.meal_ratings SET pushed_at = now() WHERE id = v_id;
      v_sent := v_sent + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'send_rating_asks(%): user %: %', p_slot, m.user_id, SQLERRM;
    END;
  END LOOP;
  RETURN v_sent;
END; $$;
REVOKE ALL ON FUNCTION public.send_rating_asks(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_rating_asks(text) TO service_role;

INSERT INTO public.notification_templates
  (key, sort_order, label, description, placeholders, title, body, default_title, default_body, enabled)
VALUES
  ('rate_meal', 160, 'Rate your meal',
   '3 PM (lunch) and 9 PM (dinner): asks to rate a meal delivered today, if the customer hasn''t seen the rating card in the app yet. How often customers are asked is set on the Feedback page. Tapping it opens the rating.',
   '{name,slot,dish}',
   'How was your {slot}?',
   'Tap to rate today''s {dish} — it takes a second and goes straight to our kitchen.',
   'How was your {slot}?',
   'Tap to rate today''s {dish} — it takes a second and goes straight to our kitchen.',
   false)                                       -- switched on once the app update is out
ON CONFLICT (key) DO NOTHING;

SELECT cron.schedule('gf-rate-lunch',  '30 9 * * *',  $$SELECT public.send_rating_asks('lunch')$$);
SELECT cron.schedule('gf-rate-dinner', '30 15 * * *', $$SELECT public.send_rating_asks('dinner')$$);

-- ── Alerts for the admins (real customers only) ─────────────────────────────
-- Each trigger swallows its own errors: an alert must never block a rating.

-- A 1–2★ rating (new, or changed down from 3★+).
CREATE OR REPLACE FUNCTION public.meal_ratings_alert_admins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text; v_code text; v_test boolean; v_tags text; v_body text;
BEGIN
  IF NEW.stars IS NULL OR NEW.stars > 2 THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.stars IS NOT NULL AND OLD.stars <= 2 THEN
    RETURN NULL;
  END IF;
  BEGIN
    SELECT btrim(name), customer_code, is_test INTO v_name, v_code, v_test FROM public.users WHERE id = NEW.user_id;
    IF v_test THEN RETURN NULL; END IF;
    SELECT string_agg(public.rating_tag_label(t), ', ') INTO v_tags FROM unnest(NEW.tags) t;
    v_body := concat_ws(' · ',
      NULLIF(NEW.dish_names, ''),
      NULLIF(v_tags, ''),
      CASE WHEN NEW.comment IS NOT NULL
           THEN '"' || left(NEW.comment, 160) || CASE WHEN char_length(NEW.comment) > 160 THEN '…' ELSE '' END || '"' END);
    PERFORM public.notify_admins('bad_rating',
      format('%s★ for %s on %s — %s', NEW.stars, NEW.meal_slot, to_char(NEW.delivery_date, 'FMDD Mon'),
             COALESCE(NULLIF(v_name, ''), v_code, 'a customer')),
      COALESCE(NULLIF(v_body, ''), 'No details given.') || ' Follow up in Feedback.',
      '/feedback?rating=' || NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'meal_ratings_alert_admins: %', SQLERRM;
  END;
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS meal_ratings_alert_admins ON public.meal_ratings;
CREATE TRIGGER meal_ratings_alert_admins AFTER INSERT OR UPDATE OF stars ON public.meal_ratings
  FOR EACH ROW EXECUTE FUNCTION public.meal_ratings_alert_admins();

-- New feedback from Account → Send feedback.
CREATE OR REPLACE FUNCTION public.app_feedback_alert_admins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text; v_code text; v_test boolean;
BEGIN
  BEGIN
    SELECT btrim(name), customer_code, is_test INTO v_name, v_code, v_test FROM public.users WHERE id = NEW.user_id;
    IF v_test THEN RETURN NULL; END IF;
    PERFORM public.notify_admins('app_feedback',
      format('Feedback from %s', COALESCE(NULLIF(v_name, ''), v_code, 'a customer')),
      CASE NEW.kind WHEN 'idea' THEN 'Idea' WHEN 'problem' THEN 'Problem' WHEN 'praise' THEN 'Compliment' ELSE 'Other' END
        || ': ' || left(NEW.message, 180) || CASE WHEN char_length(NEW.message) > 180 THEN '…' ELSE '' END,
      '/feedback?tab=app');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_feedback_alert_admins: %', SQLERRM;
  END;
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS app_feedback_alert_admins ON public.app_feedback;
CREATE TRIGGER app_feedback_alert_admins AFTER INSERT ON public.app_feedback
  FOR EACH ROW EXECUTE FUNCTION public.app_feedback_alert_admins();
