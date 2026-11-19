-- ============================================================
-- GreenFeast — Migration 095: a record of every plan change
-- ============================================================
-- "Who turned on Thursday for Karan?" had no answer: delivery days, portions,
-- add-ons, dishes and pauses could be changed by the customer (app) or the
-- office (admin) and nothing kept the before / after. Now triggers write every
-- such change to plan_change_log, with who did it:
--
--   customer  — a signed-in customer (app; the customer RPCs run as them)
--   <header>  — whoever sent x-gf-actor: the admin sends 'office:<email>' or
--               'office', the customer-facing edge functions 'customer'
--               (manage-subscription, renew-subscription), others 'system'
--   system    — no request at all (pg_cron: pauses starting / ending, …)
--
-- Logged: on subscriptions — plan, status, lunches / dinners per day, first
-- delivery date, pause dates, no delivery days, meal price, cash due, payment
-- method; delivery days (subscription_schedule); default add-ons
-- (subscription_addons); fixed dishes (customer_meal_rules).
-- Shown on the admin's subscriber profile ("Plan history"). Permanent, like the
-- money records (092): no updates or deletes.

CREATE TABLE IF NOT EXISTS public.plan_change_log (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at      timestamptz NOT NULL DEFAULT now(),
  user_id         uuid,
  subscription_id uuid,
  changed_by      text NOT NULL,          -- customer | office[:email] | system | …
  field           text NOT NULL,
  old_value       text,
  new_value       text
);
CREATE INDEX IF NOT EXISTS idx_plan_change_log_sub ON public.plan_change_log (subscription_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plan_change_log_user ON public.plan_change_log (user_id, created_at DESC);
ALTER TABLE public.plan_change_log ENABLE ROW LEVEL SECURITY;   -- service role only
REVOKE ALL ON public.plan_change_log FROM anon, authenticated;
GRANT SELECT, INSERT ON public.plan_change_log TO service_role;

CREATE OR REPLACE FUNCTION public.plan_change_log_frozen()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'plan_change_log is permanent';
END; $$;
DROP TRIGGER IF EXISTS plan_change_log_frozen ON public.plan_change_log;
CREATE TRIGGER plan_change_log_frozen BEFORE UPDATE OR DELETE ON public.plan_change_log
  FOR EACH ROW EXECUTE FUNCTION public.plan_change_log_frozen();

-- Who is making the current change.
CREATE OR REPLACE FUNCTION public.plan_change_actor()
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text := COALESCE(auth.role(), '');
  v_hdr  text;
BEGIN
  IF v_role = 'authenticated' THEN RETURN 'customer'; END IF;
  BEGIN
    v_hdr := NULLIF(current_setting('request.headers', true)::json->>'x-gf-actor', '');
  EXCEPTION WHEN OTHERS THEN v_hdr := NULL; END;
  IF v_hdr IS NOT NULL THEN RETURN left(v_hdr, 120); END IF;
  IF v_role = 'service_role' THEN RETURN 'office/service'; END IF;
  RETURN 'system';
END; $$;
REVOKE ALL ON FUNCTION public.plan_change_actor() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.log_plan_change(p_user uuid, p_sub uuid, p_field text, p_old text, p_new text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO plan_change_log (user_id, subscription_id, changed_by, field, old_value, new_value)
  SELECT p_user, p_sub, plan_change_actor(), p_field, p_old, p_new
   WHERE p_old IS DISTINCT FROM p_new
$$;
REVOKE ALL ON FUNCTION public.log_plan_change(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;

-- ── subscriptions ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.subscriptions_log_changes()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM log_plan_change(NEW.user_id, NEW.id, 'plan created', NULL,
      format('%s · %s lunch / %s dinner a day · %s', NEW.plan_id, COALESCE(NEW.meals_lunch, 0),
             COALESCE(NEW.meals_dinner, 0), NEW.status));
    RETURN NULL;
  END IF;
  PERFORM log_plan_change(NEW.user_id, NEW.id, 'plan', OLD.plan_id, NEW.plan_id);
  PERFORM log_plan_change(NEW.user_id, NEW.id, 'status', OLD.status, NEW.status);
  PERFORM log_plan_change(NEW.user_id, NEW.id, 'lunches a day', OLD.meals_lunch::text, NEW.meals_lunch::text);
  PERFORM log_plan_change(NEW.user_id, NEW.id, 'dinners a day', OLD.meals_dinner::text, NEW.meals_dinner::text);
  PERFORM log_plan_change(NEW.user_id, NEW.id, 'first delivery', OLD.start_date::text, NEW.start_date::text);
  PERFORM log_plan_change(NEW.user_id, NEW.id, 'pause',
    CASE WHEN OLD.pause_from IS NULL THEN NULL ELSE OLD.pause_from || ' – ' || COALESCE(OLD.pause_until::text, '?') END,
    CASE WHEN NEW.pause_from IS NULL THEN NULL ELSE NEW.pause_from || ' – ' || COALESCE(NEW.pause_until::text, '?') END);
  PERFORM log_plan_change(NEW.user_id, NEW.id, 'no delivery days', OLD.no_delivery_days::text, NEW.no_delivery_days::text);
  PERFORM log_plan_change(NEW.user_id, NEW.id, 'meal price (paise)', OLD.meal_price_paise::text, NEW.meal_price_paise::text);
  PERFORM log_plan_change(NEW.user_id, NEW.id, 'cash due (paise)', OLD.cod_due_paise::text, NEW.cod_due_paise::text);
  PERFORM log_plan_change(NEW.user_id, NEW.id, 'payment method', OLD.payment_method, NEW.payment_method);
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.subscriptions_log_changes() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS subscriptions_log_changes ON public.subscriptions;
CREATE TRIGGER subscriptions_log_changes
  AFTER INSERT OR UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.subscriptions_log_changes();

-- ── delivery days ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.schedule_log_changes()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sub  uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.subscription_id ELSE NEW.subscription_id END;
  v_user uuid;
BEGIN
  SELECT user_id INTO v_user FROM subscriptions WHERE id = v_sub;
  IF v_user IS NULL THEN RETURN NULL; END IF;   -- the plan itself is being deleted
  IF TG_OP = 'INSERT' THEN
    PERFORM log_plan_change(v_user, v_sub, 'delivery day', NULL, NEW.day_of_week || ' on');
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM log_plan_change(v_user, v_sub, 'delivery day', OLD.day_of_week || ' on', NULL);
  END IF;
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.schedule_log_changes() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS schedule_log_changes ON public.subscription_schedule;
CREATE TRIGGER schedule_log_changes
  AFTER INSERT OR DELETE ON public.subscription_schedule
  FOR EACH ROW EXECUTE FUNCTION public.schedule_log_changes();

-- ── default add-ons ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.plan_addons_log_changes()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sub  uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.subscription_id ELSE NEW.subscription_id END;
  v_user uuid;
BEGIN
  SELECT user_id INTO v_user FROM subscriptions WHERE id = v_sub;
  IF v_user IS NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM log_plan_change(v_user, v_sub, 'add-on', NULL, NEW.addon_id || COALESCE(' (' || NEW.sub_option || ')', ''));
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM log_plan_change(v_user, v_sub, 'add-on', OLD.addon_id || COALESCE(' (' || OLD.sub_option || ')', ''), NULL);
  ELSE
    PERFORM log_plan_change(v_user, v_sub, 'add-on ' || NEW.addon_id || ' flavour', OLD.sub_option, NEW.sub_option);
  END IF;
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.plan_addons_log_changes() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS plan_addons_log_changes ON public.subscription_addons;
CREATE TRIGGER plan_addons_log_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.subscription_addons
  FOR EACH ROW EXECUTE FUNCTION public.plan_addons_log_changes();

-- ── fixed dishes ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.meal_rules_log_changes()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r      record;
  v_sub  uuid;
  v_day  text;
BEGIN
  r := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = r.user_id) THEN RETURN NULL; END IF;
  SELECT id INTO v_sub FROM subscriptions WHERE user_id = r.user_id AND status IN ('active', 'paused')
   ORDER BY created_at DESC LIMIT 1;
  v_day := CASE WHEN r.day_of_week IS NULL THEN 'every day'
                ELSE (ARRAY['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])[r.day_of_week + 1] END;
  IF TG_OP = 'DELETE' THEN
    PERFORM log_plan_change(r.user_id, v_sub, format('fixed %s dish, %s', r.meal_slot, v_day), OLD.meal_template_id, NULL);
  ELSE
    PERFORM log_plan_change(r.user_id, v_sub, format('fixed %s dish, %s', r.meal_slot, v_day),
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.meal_template_id END, NEW.meal_template_id);
  END IF;
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.meal_rules_log_changes() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS meal_rules_log_changes ON public.customer_meal_rules;
CREATE TRIGGER meal_rules_log_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.customer_meal_rules
  FOR EACH ROW EXECUTE FUNCTION public.meal_rules_log_changes();

NOTIFY pgrst, 'reload schema';
