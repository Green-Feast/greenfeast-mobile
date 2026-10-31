-- ============================================================
-- GreenFeast — Migration 071: meals with no address take the default one
-- ============================================================
-- A plan set up before the customer had an address made its meals with no
-- address — so no batch, and no rider route — and adding the address later
-- didn't reach them (Chhayal, 1 Nov: address on Nemi Ji Batch, meals "No
-- address"). Now when an address becomes a customer's default, their upcoming
-- open meals that have no address take it; order_batch_from_address (052)
-- then gives them its batch.

CREATE OR REPLACE FUNCTION public.address_fill_unaddressed_meals()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_default AND NEW.archived_at IS NULL THEN
    UPDATE orders SET address_id = NEW.id, updated_at = now()
     WHERE user_id = NEW.user_id
       AND address_id IS NULL
       AND delivery_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
       AND status IN ('scheduled', 'confirmed', 'preparing');
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.address_fill_unaddressed_meals() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS addresses_fill_unaddressed_meals ON public.addresses;
CREATE TRIGGER addresses_fill_unaddressed_meals
  AFTER INSERT OR UPDATE OF is_default, archived_at ON public.addresses
  FOR EACH ROW EXECUTE FUNCTION public.address_fill_unaddressed_meals();

-- Meals already waiting: same rule, once.
UPDATE public.orders o
   SET address_id = a.id, updated_at = now()
  FROM public.addresses a
 WHERE a.user_id = o.user_id AND a.is_default AND a.archived_at IS NULL
   AND o.address_id IS NULL
   AND o.delivery_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
   AND o.status IN ('scheduled', 'confirmed', 'preparing');
