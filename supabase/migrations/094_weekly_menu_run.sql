-- ============================================================
-- GreenFeast — Migration 094: meals are made a week at a time, on Sunday
-- ============================================================
-- Until now instantiate-orders made every plan's meals 14 days ahead, every
-- night. The kitchen sets the weekly menu late, so customers saw dishes that
-- then changed, and days just past the window looked like "no meal".
--
-- Now:
--   * order_publishing.published_until is the last day meals exist for. It is
--     always a Sunday: this week's until Sunday 7 PM, then next week's.
--   * The kitchen finishes next week's menu by Sunday 6 PM (admins get a
--     reminder at 2 PM). If they don't, the weekly menu simply stays as it was —
--     last week's dishes are used.
--   * Sunday 7 PM (admin cron /api/cron/weekly-menu): publish_next_week() moves
--     published_until to the next Sunday, instantiate-orders makes everyone's
--     meals up to it, and weekly_menu_ready tells customers who got meals.
--     Menu edits after that still reach those meals (propagateMenuChanges).
--   * Every other run — the 1 AM safety run, and the per-customer runs after a
--     plan change (Plan & settings, resume, payment, admin plan edit) — fills
--     gaps only up to published_until, never into an unpublished week.
--   * The app shows "this week's menu isn't out yet" for days after it
--     (menu_published_until()).
--
-- Switch-over: meals already made after this Sunday (22 Nov) that nobody
-- changed by hand are removed; Sunday's run makes them again from the menu.
-- Hand-edited meals, extra dishes and walk-ins stay.

CREATE TABLE IF NOT EXISTS public.order_publishing (
  id              boolean PRIMARY KEY DEFAULT true CHECK (id),   -- one row
  published_until date NOT NULL,
  published_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.order_publishing ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_publishing FROM anon, authenticated;
GRANT ALL ON public.order_publishing TO service_role;

-- The Sunday ending the current week (today when it's Sunday).
CREATE OR REPLACE FUNCTION public.ist_week_sunday(p_day date)
RETURNS date
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_day + (7 - extract(isodow FROM p_day)::int)
$$;

INSERT INTO public.order_publishing (id, published_until)
VALUES (true, public.ist_week_sunday((now() AT TIME ZONE 'Asia/Kolkata')::date))
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.menu_published_until()
RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT published_until FROM public.order_publishing WHERE id
$$;
REVOKE ALL ON FUNCTION public.menu_published_until() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.menu_published_until() TO anon, authenticated, service_role;

-- Sunday 7 PM: next week is published (next Sunday). Run on any other day it
-- publishes up to the Sunday after this week's — never further.
CREATE OR REPLACE FUNCTION public.publish_next_week()
RETURNS date
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_until date := public.ist_week_sunday(v_today) + CASE WHEN extract(isodow FROM v_today) = 7 THEN 7 ELSE 0 END;
BEGIN
  UPDATE order_publishing
     SET published_until = GREATEST(published_until, v_until), published_at = now()
   WHERE id;
  RETURN (SELECT published_until FROM order_publishing WHERE id);
END; $$;
REVOKE ALL ON FUNCTION public.publish_next_week() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_next_week() TO service_role;

-- After the Sunday run: tell every customer who has meals in the new week.
CREATE OR REPLACE FUNCTION public.notify_weekly_menu(p_from date, p_to date)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  u record;
  n integer := 0;
BEGIN
  FOR u IN
    SELECT DISTINCT o.user_id FROM orders o
     WHERE o.delivery_date BETWEEN p_from AND p_to
       AND o.fulfilment = 'delivery' AND NOT o.walk_in
       AND o.status IN ('scheduled', 'confirmed')
  LOOP
    PERFORM notify_event(u.user_id, 'weekly_menu_ready',
      jsonb_build_object('from', to_char(p_from, 'FMDD Mon'), 'to', to_char(p_to, 'FMDD Mon')));
    n := n + 1;
  END LOOP;
  RETURN n;
END; $$;
REVOKE ALL ON FUNCTION public.notify_weekly_menu(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_weekly_menu(date, date) TO service_role;

INSERT INTO public.notification_templates
  (key, sort_order, label, description, placeholders, title, body, default_title, default_body, enabled)
VALUES
  ('weekly_menu_ready', 169, 'Next week''s menu is out',
   'Sunday 7 PM, after next week''s meals are made — to every customer who has meals that week.',
   '{name,from,to}',
   'Your meals for next week are ready',
   'Your meals for {from} – {to} are set. See them in My Plan — swap a dish or skip a day before each meal''s cutoff.',
   'Your meals for next week are ready',
   'Your meals for {from} – {to} are set. See them in My Plan — swap a dish or skip a day before each meal''s cutoff.',
   true)
ON CONFLICT (key) DO NOTHING;

-- Sunday 2 PM IST: remind the office the menu closes at 6 PM.
SELECT cron.unschedule('gf-weekly-menu-reminder')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gf-weekly-menu-reminder');
SELECT cron.schedule('gf-weekly-menu-reminder', '30 8 * * 0', $$
  SELECT public.notify_admins('menu_reminder',
    'Finish next week''s menu by 6 PM',
    'Next week''s meals are made for every customer at 7 PM today from the Kitchen tab''s weekly menu. Anything not changed by then stays as this week''s.',
    '/kitchen')
$$);

-- ── Switch-over ─────────────────────────────────────────────────────────────
DELETE FROM public.orders o
 WHERE o.delivery_date > (SELECT published_until FROM public.order_publishing WHERE id)
   AND o.status IN ('scheduled', 'confirmed')
   AND NOT o.cart_edited
   AND NOT COALESCE(o.extra_dish, false)
   AND NOT o.walk_in;

NOTIFY pgrst, 'reload schema';
