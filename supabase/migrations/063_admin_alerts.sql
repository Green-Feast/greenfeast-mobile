-- ============================================================
-- GreenFeast — Migration 063: alerts for the admins
-- ============================================================
-- Reminders and important updates for whoever runs the admin: a list in the
-- admin (Alerts, with an unread badge) and a web push on every device an
-- admin switched alerts on for (admin_push_subscriptions; the admin-push
-- edge function sends them — Web Push needs encryption Postgres can't do).
--
--   Reminders (pg_cron, IST):
--     12:30  lunch meals not marked "out for delivery" yet
--     14:30  lunch meals not marked delivered (not billed until they are)
--     17:30  dinner not out for delivery
--     19:30  dinner not delivered
--     09:30  yesterday's meals never marked delivered
--   As they happen:
--     a partner reported cash collected       → record it
--     a partner couldn't deliver a meal       → decide in Operations
--     an online payment came in (plan / top-up)
--     a bank refund failed
-- Real customers only — test accounts never alert.
-- ============================================================

ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS alerts_read_at timestamptz;

CREATE TABLE IF NOT EXISTS public.admin_alerts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       text NOT NULL,
  title      text NOT NULL,
  body       text NOT NULL,
  url        text NOT NULL DEFAULT '/dashboard',
  created_at timestamptz NOT NULL DEFAULT now(),
  pushed_at  timestamptz
);
CREATE INDEX IF NOT EXISTS admin_alerts_recent ON public.admin_alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_alerts_unpushed ON public.admin_alerts (created_at) WHERE pushed_at IS NULL;
ALTER TABLE public.admin_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_alerts FROM anon, authenticated;
GRANT ALL ON public.admin_alerts TO service_role;

CREATE TABLE IF NOT EXISTS public.admin_push_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   uuid NOT NULL REFERENCES public.admin_users(user_id) ON DELETE CASCADE,
  endpoint   text NOT NULL UNIQUE,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_ok_at timestamptz
);
ALTER TABLE public.admin_push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_push_subscriptions FROM anon, authenticated;
GRANT ALL ON public.admin_push_subscriptions TO service_role;

-- ── Raise one ──────────────────────────────────────────────────────────────
-- Saves the alert and wakes the admin-push function, which sends whatever
-- hasn't been pushed yet (so a lost wake-up is caught by the next one).
CREATE OR REPLACE FUNCTION public.notify_admins(p_kind text, p_title text, p_body text, p_url text DEFAULT '/dashboard')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.admin_alerts (kind, title, body, url) VALUES (p_kind, p_title, p_body, COALESCE(p_url, '/dashboard'));
  PERFORM net.http_post(
    url     := 'https://amwwjcwoumhbdxaxvexj.supabase.co/functions/v1/admin-push',
    body    := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
END; $$;
REVOKE ALL ON FUNCTION public.notify_admins(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_admins(text, text, text, text) TO service_role;

-- ── Reminders: meals not marked yet ────────────────────────────────────────
-- p_stage: 'out' (not out for delivery yet), 'delivered' (not delivered),
-- 'yesterday' (yesterday's, never marked delivered).
CREATE OR REPLACE FUNCTION public.admin_delivery_reminder(p_slot text, p_stage text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_date  date := CASE WHEN p_stage = 'yesterday' THEN v_today - 1 ELSE v_today END;
  v_total integer;
  v_list  text;
  v_slot  text := CASE p_slot WHEN 'dinner' THEN 'Dinner' WHEN 'lunch' THEN 'Lunch' ELSE 'Meals' END;
BEGIN
  SELECT sum(n), string_agg(batch || ' ' || n, ' · ' ORDER BY batch)
    INTO v_total, v_list
    FROM (
      SELECT COALESCE(btrim(b.name), 'Unassigned') AS batch, count(*)::int AS n
        FROM public.orders o
        JOIN public.users u ON u.id = o.user_id
        LEFT JOIN public.batches b ON b.id = o.batch_id
       WHERE o.delivery_date = v_date
         AND (p_slot = 'all' OR o.meal_slot = p_slot)
         AND NOT u.is_test
         AND CASE WHEN p_stage = 'out' THEN o.status IN ('scheduled', 'confirmed', 'preparing')
                  ELSE o.status IN ('scheduled', 'confirmed', 'preparing', 'out_for_delivery') END
       GROUP BY 1
    ) x;

  IF COALESCE(v_total, 0) = 0 THEN
    RETURN 0;
  END IF;

  IF p_stage = 'out' THEN
    PERFORM public.notify_admins('reminder_out',
      format('%s: %s meal%s not out for delivery', v_slot, v_total, CASE WHEN v_total = 1 THEN '' ELSE 's' END),
      v_list || '. Mark them in Operations (or partners do it in their app).',
      '/operations');
  ELSIF p_stage = 'delivered' THEN
    PERFORM public.notify_admins('reminder_delivered',
      format('%s: %s meal%s not marked delivered', v_slot, v_total, CASE WHEN v_total = 1 THEN '' ELSE 's' END),
      v_list || '. Customers aren''t charged until a meal is marked delivered.',
      '/operations');
  ELSE
    PERFORM public.notify_admins('reminder_yesterday',
      format('Yesterday: %s meal%s never marked delivered', v_total, CASE WHEN v_total = 1 THEN '' ELSE 's' END),
      v_list || '. Open Operations for yesterday and mark them (or skip them).',
      '/operations?date=' || v_date::text);
  END IF;
  RETURN v_total;
END; $$;
REVOKE ALL ON FUNCTION public.admin_delivery_reminder(text, text) FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('gf-admin-lunch-out',        '0 7 * * *',  $$SELECT public.admin_delivery_reminder('lunch', 'out')$$);
SELECT cron.schedule('gf-admin-lunch-delivered',  '0 9 * * *',  $$SELECT public.admin_delivery_reminder('lunch', 'delivered')$$);
SELECT cron.schedule('gf-admin-dinner-out',       '0 12 * * *', $$SELECT public.admin_delivery_reminder('dinner', 'out')$$);
SELECT cron.schedule('gf-admin-dinner-delivered', '0 14 * * *', $$SELECT public.admin_delivery_reminder('dinner', 'delivered')$$);
SELECT cron.schedule('gf-admin-yesterday',        '0 4 * * *',  $$SELECT public.admin_delivery_reminder('all', 'yesterday')$$);

-- ── As it happens ──────────────────────────────────────────────────────────
-- Each trigger swallows its own errors: an alert must never block the change.

-- A partner reported cash collected.
CREATE OR REPLACE FUNCTION public.cash_reports_alert_admins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text; v_test boolean; v_partner text;
BEGIN
  BEGIN
    SELECT btrim(name), is_test INTO v_name, v_test FROM public.users WHERE id = NEW.user_id;
    IF v_test THEN RETURN NULL; END IF;
    SELECT btrim(name) INTO v_partner FROM public.delivery_partners WHERE id = NEW.partner_id;
    PERFORM public.notify_admins('cash_reported',
      format('Cash collected: %s from %s', public.inr(NEW.amount_paise), COALESCE(NULLIF(v_name, ''), 'a customer')),
      format('%s has it. Record it in Operations when it''s handed over — until then their next meal can skip.', COALESCE(v_partner, 'The partner')),
      '/operations');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'cash_reports_alert_admins: %', SQLERRM;
  END;
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS cash_reports_alert_admins ON public.cash_reports;
CREATE TRIGGER cash_reports_alert_admins AFTER INSERT ON public.cash_reports
  FOR EACH ROW EXECUTE FUNCTION public.cash_reports_alert_admins();

-- A partner couldn't deliver a meal.
CREATE OR REPLACE FUNCTION public.orders_alert_admins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text; v_test boolean; v_partner text;
BEGIN
  IF NEW.delivery_issue IS NULL OR OLD.delivery_issue IS NOT NULL THEN
    RETURN NULL;
  END IF;
  BEGIN
    SELECT btrim(name), is_test INTO v_name, v_test FROM public.users WHERE id = NEW.user_id;
    IF v_test THEN RETURN NULL; END IF;
    SELECT btrim(name) INTO v_partner FROM public.delivery_partners WHERE id = NEW.delivery_partner_id;
    PERFORM public.notify_admins('failed_drop',
      format('Couldn''t deliver: %s''s %s', COALESCE(NULLIF(v_name, ''), 'a customer'), NEW.meal_slot),
      format('%s — %s. Deliver or skip it in Operations.', COALESCE(v_partner, 'Partner'), NEW.delivery_issue),
      '/operations?date=' || NEW.delivery_date::text);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'orders_alert_admins: %', SQLERRM;
  END;
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS orders_alert_admins ON public.orders;
CREATE TRIGGER orders_alert_admins AFTER UPDATE OF delivery_issue ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_alert_admins();

-- An online (Cashfree) payment came in — a plan or a wallet top-up. Cash the
-- office records itself has no cf_order_id and doesn't alert.
CREATE OR REPLACE FUNCTION public.payments_alert_admins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text; v_test boolean;
BEGIN
  IF NEW.status <> 'paid' OR NEW.cf_order_id IS NULL OR (TG_OP = 'UPDATE' AND OLD.status = 'paid') THEN
    RETURN NULL;
  END IF;
  BEGIN
    SELECT btrim(name), is_test INTO v_name, v_test FROM public.users WHERE id = NEW.user_id;
    IF v_test THEN RETURN NULL; END IF;
    PERFORM public.notify_admins('payment',
      format('Payment received: %s from %s', public.inr(NEW.amount), COALESCE(NULLIF(v_name, ''), 'a customer')),
      CASE WHEN NEW.cf_order_id LIKE 'topup_%' THEN 'Wallet top-up, paid online.' ELSE 'Plan payment, paid online.' END,
      '/money');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'payments_alert_admins: %', SQLERRM;
  END;
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS payments_alert_admins ON public.payments;
CREATE TRIGGER payments_alert_admins AFTER INSERT OR UPDATE OF status ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payments_alert_admins();

-- A bank refund failed.
CREATE OR REPLACE FUNCTION public.refunds_alert_admins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text; v_test boolean;
BEGIN
  IF NEW.status <> 'failed' OR OLD.status = 'failed' THEN
    RETURN NULL;
  END IF;
  BEGIN
    SELECT btrim(name), is_test INTO v_name, v_test FROM public.users WHERE id = NEW.user_id;
    IF v_test THEN RETURN NULL; END IF;
    PERFORM public.notify_admins('refund_failed',
      format('Bank refund failed: %s for %s', public.inr(NEW.amount), COALESCE(NULLIF(v_name, ''), 'a customer')),
      COALESCE(NULLIF(NEW.failure_note, ''), 'Cashfree couldn''t complete it.') || ' Check Money.',
      '/money');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'refunds_alert_admins: %', SQLERRM;
  END;
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS refunds_alert_admins ON public.refunds;
CREATE TRIGGER refunds_alert_admins AFTER UPDATE OF status ON public.refunds
  FOR EACH ROW EXECUTE FUNCTION public.refunds_alert_admins();
