-- ============================================================
-- GreenFeast — Migration 050: customers can't activate or edit plans
-- ============================================================
-- Customers could write every column of their own subscriptions through the
-- public API: insert a plan already 'active' with any meal count, or switch
-- their own plan to 'active' (the app itself did this after checkout) or to
-- 'pending' + 'cod' (delivered on credit). Onboarding still creates its own
-- plan row, but only ever as an unpaid 'pending' plan with no meals; all later
-- changes — activation (cashfree-webhook), counters, batches, pause/cancel
-- (manage-subscription), admin — run as service_role.
REVOKE UPDATE, DELETE, TRUNCATE ON public.subscriptions FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_customer_subscription_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;
  NEW.status := 'pending';
  NEW.deliveries_remaining := 0;
  NEW.batch_id_lunch := NULL;
  NEW.batch_id_dinner := NULL;
  NEW.renewed_from := NULL;
  NEW.pause_from := NULL;
  NEW.pause_until := NULL;
  NEW.end_date := NULL;
  NEW.last_renewal_reminder_sent_at := NULL;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS subscriptions_guard_customer_insert ON public.subscriptions;
CREATE TRIGGER subscriptions_guard_customer_insert
  BEFORE INSERT ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.guard_customer_subscription_insert();
