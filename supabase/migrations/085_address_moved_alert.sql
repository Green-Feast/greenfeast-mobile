-- ============================================================
-- GreenFeast — Migration 085: tell the office when a customer moves an address
-- ============================================================
-- An address keeps its delivery batch when its text changes. When a customer
-- edits an address to somewhere else (app → Addresses → Edit, or onboarding
-- again for a new plan, which rewrites their default address), their meals
-- kept riding the old area's route. Customers can't set batches, so the office
-- has to: when a customer changes an address's street / pincode / map pin and
-- it has meals still to come, the admins get an alert (Alerts, push) with a
-- link to the customer. Office edits don't alert — the office is already there.

CREATE OR REPLACE FUNCTION public.address_moved_alert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  u      record;
  v_sub  uuid;
  v_meals integer;
BEGIN
  -- The caller's login role (current_user is this function's owner here).
  IF COALESCE(auth.role(), '') <> 'authenticated' THEN RETURN NULL; END IF;
  IF NEW.archived_at IS NOT NULL THEN RETURN NULL; END IF;
  IF NEW.line1 IS NOT DISTINCT FROM OLD.line1
     AND NEW.pincode IS NOT DISTINCT FROM OLD.pincode
     AND NEW.lat IS NOT DISTINCT FROM OLD.lat
     AND NEW.lng IS NOT DISTINCT FROM OLD.lng THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO v_meals FROM orders
   WHERE address_id = NEW.id AND fulfilment = 'delivery'
     AND delivery_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
     AND status IN ('scheduled', 'confirmed');
  IF v_meals = 0 THEN RETURN NULL; END IF;

  SELECT name, customer_code, is_test INTO u FROM users WHERE id = NEW.user_id;
  IF COALESCE(u.is_test, false) THEN RETURN NULL; END IF;
  SELECT id INTO v_sub FROM subscriptions WHERE user_id = NEW.user_id AND status IN ('active', 'paused')
   ORDER BY created_at DESC LIMIT 1;

  PERFORM notify_admins('address_moved',
    format('%s changed an address', COALESCE(u.name, 'A customer')),
    format('%s (%s) changed "%s" to: %s%s. %s upcoming meal%s go there — check its lunch / dinner batch.',
      COALESCE(u.name, 'Customer'), COALESCE(u.customer_code, '—'), COALESCE(NEW.label, 'address'),
      NEW.line1, COALESCE(' (' || NULLIF(NEW.pincode, '') || ')', ''),
      v_meals, CASE WHEN v_meals = 1 THEN '' ELSE 's' END),
    CASE WHEN v_sub IS NOT NULL THEN '/subscribers/' || v_sub::text ELSE '/batches' END);
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.address_moved_alert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS addresses_moved_alert ON public.addresses;
CREATE TRIGGER addresses_moved_alert
  AFTER UPDATE OF line1, pincode, lat, lng ON public.addresses
  FOR EACH ROW EXECUTE FUNCTION public.address_moved_alert();
