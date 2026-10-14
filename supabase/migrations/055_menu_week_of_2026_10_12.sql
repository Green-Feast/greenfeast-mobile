-- ============================================================
-- GreenFeast — Migration 055: subscribers' menu (week of 12 Oct 2026)
-- ============================================================
-- Mon Quinoa Buddha Bowl · Tue Burrito Bowl · Wed Umami Soba Bowl ·
-- Thu Lebanese Panini · Fri Chef's Special · Sat BBQ Protein Wrap
-- (lunch and dinner; Sunday has no menu). Two dishes are new: the Lebanese
-- Panini (from the menu card) and Chef's Special (the kitchen's pick each
-- Friday). Both are subscription-only (not on the Menu tab).
-- Upcoming meals nobody changed — and that aren't past their cutoff — move
-- to the new dish for their day, the same as saving the menu in the admin
-- Kitchen page does.
-- ============================================================

INSERT INTO public.meal_templates
  (id, name, category, price, description, short_description, kcal, protein, fibre,
   is_active, menu_visible, subscription_valid)
VALUES
  ('lebanese-panini', 'Lebanese Panini', 'panini', 34900,
   'Beetroot panini with chickpeas, loaded with lettuce, bell pepper, pickled cabbage, pickled onion and cheese, dressed with hummus dip.',
   'Beetroot panini, chickpeas, pickled cabbage & onion, cheese, hummus dip',
   500, 21, 11, true, false, true),
  ('chefs-special', 'Chef''s Special', 'bowl', 34900,
   'Our chef''s pick of the week — something new every Friday.',
   'Something new from our chef every Friday',
   NULL, NULL, NULL, true, false, true)
ON CONFLICT (id) DO NOTHING;

-- The menu card's numbers for the wrap, which had none.
UPDATE public.meal_templates
   SET kcal = COALESCE(kcal, 500), protein = COALESCE(protein, 19), fibre = COALESCE(fibre, 8), updated_at = now()
 WHERE id = 'bbq-protein-wrap';

-- Mon=0 … Sat=5, lunch and dinner.
WITH menu(day_of_week, meal_template_id) AS (
  VALUES (0, 'quinoa-buddha-bowl'), (1, 'burrito-bowl'), (2, 'umami-soba-bowl'),
         (3, 'lebanese-panini'), (4, 'chefs-special'), (5, 'bbq-protein-wrap')
), rows AS (
  SELECT m.day_of_week, s.slot AS meal_slot, m.meal_template_id
    FROM menu m CROSS JOIN (VALUES ('lunch'), ('dinner')) s(slot)
)
INSERT INTO public.weekly_menu (menu_type, day_of_week, meal_slot, meal_template_id)
SELECT 'M1', day_of_week, meal_slot, meal_template_id FROM rows
ON CONFLICT (menu_type, day_of_week, meal_slot)
DO UPDATE SET meal_template_id = EXCLUDED.meal_template_id, updated_at = now();

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT o.id, wm.meal_template_id AS new_meal
      FROM orders o
      JOIN weekly_menu wm
        ON wm.menu_type = 'M1'
       AND wm.day_of_week = EXTRACT(ISODOW FROM o.delivery_date)::int - 1
       AND wm.meal_slot = o.meal_slot
     WHERE o.status IN ('scheduled', 'confirmed')
       AND o.is_customized = false
       AND o.extra_dish = false
       AND o.delivery_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
       AND NOT is_slot_locked(o.delivery_date, o.meal_slot)
       AND o.meal_template_id IS DISTINCT FROM wm.meal_template_id
  LOOP
    UPDATE orders SET meal_template_id = r.new_meal, updated_at = now() WHERE id = r.id;
    PERFORM snapshot_order_ingredients(r.id);
  END LOOP;
END $$;
