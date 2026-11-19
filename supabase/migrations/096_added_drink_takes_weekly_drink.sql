-- ============================================================
-- GreenFeast — Migration 096: an added drink is the day's drink
-- ============================================================
-- The kitchen sets the week's drinks in the weekly menu (088). Meals made with
-- a drink take it from there. But a drink added to a single day (day cart, or
-- the admin's per-day editor) on a plan without one left the order with no
-- drink dish: the sheets printed "Drink not picked" and the kitchen didn't
-- make the paid smoothie (Ashok Jagwani, 19 Nov).
--
-- Now adding a drink add-on line to an order that has no drink yet gives it
-- that day / slot's weekly drink (dish id on the order, its name on the line),
-- the same as a meal made with the drink. A drink swapped by hand stays.

CREATE OR REPLACE FUNCTION public.order_addons_weekly_drink()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o      record;
  v_id   text;
  v_name text;
BEGIN
  IF NEW.kind IS DISTINCT FROM 'addon' OR NEW.addon_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM addons WHERE id = NEW.addon_id AND is_drink) THEN
    RETURN NEW;
  END IF;
  SELECT id, delivery_date, meal_slot, drink_template_id INTO o FROM orders WHERE id = NEW.order_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF o.drink_template_id IS NULL THEN
    SELECT w.drink_template_id INTO v_id FROM weekly_menu w
     WHERE w.menu_type = 'M1' AND w.meal_slot = o.meal_slot
       AND w.day_of_week = extract(isodow FROM o.delivery_date)::int - 1;
    IF v_id IS NOT NULL THEN
      UPDATE orders SET drink_template_id = v_id WHERE id = o.id;
    END IF;
  ELSE
    v_id := o.drink_template_id;
  END IF;

  IF v_id IS NOT NULL AND NULLIF(btrim(COALESCE(NEW.sub_option, '')), '') IS NULL THEN
    SELECT name INTO v_name FROM meal_templates WHERE id = v_id;
    NEW.sub_option := v_name;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.order_addons_weekly_drink() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS order_addons_weekly_drink ON public.order_addons;
CREATE TRIGGER order_addons_weekly_drink
  BEFORE INSERT ON public.order_addons
  FOR EACH ROW EXECUTE FUNCTION public.order_addons_weekly_drink();

-- Open meals that already have a drink line but no drink: the day's drink.
WITH fix AS (
  SELECT o.id, w.drink_template_id AS drink
    FROM orders o
    JOIN weekly_menu w ON w.menu_type = 'M1' AND w.meal_slot = o.meal_slot
                      AND w.day_of_week = extract(isodow FROM o.delivery_date)::int - 1
   WHERE o.status IN ('scheduled', 'confirmed', 'preparing')
     AND o.delivery_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
     AND o.drink_template_id IS NULL
     AND w.drink_template_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM order_addons a JOIN addons ad ON ad.id = a.addon_id
                  WHERE a.order_id = o.id AND ad.is_drink)
)
UPDATE orders o SET drink_template_id = fix.drink FROM fix WHERE o.id = fix.id;

UPDATE order_addons a
   SET sub_option = t.name
  FROM orders o, addons ad, meal_templates t
 WHERE a.order_id = o.id AND ad.id = a.addon_id AND ad.is_drink
   AND t.id = o.drink_template_id
   AND o.status IN ('scheduled', 'confirmed', 'preparing')
   AND o.delivery_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
   AND NULLIF(btrim(COALESCE(a.sub_option, '')), '') IS NULL;
