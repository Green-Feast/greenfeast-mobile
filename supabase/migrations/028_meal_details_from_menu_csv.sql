-- ============================================================
-- GreenFeast — Migration 028: Refresh meal details from POS menu export
-- Run AFTER 027_dietary_targets.sql
--
-- 003_seed.sql's meal_templates rows were placeholder copy written before the
-- kitchen's real POS menu existed. This updates description/kcal/protein for
-- the rows that clearly correspond to a real menu item (matched by name/
-- category, corroborated by price already matching), using the wording from
-- the kitchen's own menu export. Only existing rows are touched — nothing is
-- inserted, and rows with no confident match are left untouched:
--   indian-spice-bowl, korean-bibimbap-bowl, mediterranean-falafel-wrap,
--   thai-peanut-wrap, greek-quinoa-salad, asian-sesame-salad,
--   moroccan-chickpea-salad, egg-white-toast, and all 3 smoothies (the
--   export's smoothie prices don't match ours — needs a manual check, not a
--   guess — see chat for the exact discrepancy).
--
-- carbs/fat are left as-is: the export only ever states protein + kcal (+
-- fibre, which we don't have a column for), never a carbs/fat breakdown.
-- ============================================================

UPDATE public.meal_templates SET
  description = 'Hydroponic greens, brown rice, chilli tofu, bell pepper fajita, green papaya, carrot, cucumber, cherry tomato confit, peanuts, micro greens, pickled onion, in house peanut dressing.',
  kcal = 450,
  protein = 17.0
WHERE id = 'thai-zen-bowl';

UPDATE public.meal_templates SET
  description = 'Wheat pasta, hydroponic greens, sautéed mushroom, bell peppers, broccoli, zucchini, caramelized onion, lettuce, basil, olives, cherry tomato, microgreens, pumpkin seeds, feta cheese, in house dressing.',
  kcal = 430,
  protein = 15.0
WHERE id = 'italian-harvest-bowl';

UPDATE public.meal_templates SET
  description = 'Mixed hydroponic greens, herbed brown rice, mixed beans, hass avocado, bell peppers fajitas, pineapple salsa, charred corn, cherry tomato, nachos, mixed seeds, microgreens, in house chipotle dressing.',
  kcal = 470,
  protein = 18.0
WHERE id = 'mexican-fiesta-bowl';

-- Matched to the export's "Umami Soba Bowl" — same Asian/umami concept, only
-- distinctively-named umami bowl in the export.
UPDATE public.meal_templates SET
  description = 'Hydroponic bok choy, lettuce, soba noodles, grilled paneer/tofu, bell peppers fajita, red cabbage, carrot, cucumber, cherry tomato, microgreens, sesame seeds, peanuts, in house peanut dressing.',
  kcal = 490,
  protein = 23.0
WHERE id = 'japanese-umami-bowl';

-- Matched to the export's "Mediterranean Bliss Bowl" — only Mediterranean
-- bowl in the export; kept our existing "Mezze" name.
UPDATE public.meal_templates SET
  description = 'Hydroponic greens, couscous tabbouleh, paneer, herbed chickpeas, roasted beetroot, red cabbage, cherry tomato, pickled onion, carrot, feta cheese, mixed seeds, in house beetroot hummus, micro greens, in house tahini dressing.',
  kcal = 590,
  protein = 23.0
WHERE id = 'mediterranean-mezze-bowl';

UPDATE public.meal_templates SET
  description = 'Multigrain beetroot tortilla, sautéed paneer, avocado, lettuce, salsa, corn, grilled bell pepper, jalapeños, olives, beans, cheddar, chipotle spread.',
  kcal = 490,
  protein = 20.0
WHERE id = 'smoky-chipotle-wrap';

UPDATE public.meal_templates SET
  description = 'Beetroot multigrain tortilla, lettuce, tandoori paneer, cucumber, bell peppers, desi onion masala in house tandoori spread.',
  kcal = 450,
  protein = 19.8
WHERE id = 'bbq-protein-wrap';

-- Matched to the export's "Classic Caesar Salad" — only Caesar salad in the export.
UPDATE public.meal_templates SET
  description = 'Romaine lettuce, thyme rosemary croutons, cherry tomatoes, parmesan cheese, bell peppers, broccoli, in house caesar dressing.',
  kcal = 300,
  protein = 6.7
WHERE id = 'caesar-power-salad';

-- Matched to the export's "Avo Feta Toast" — only avocado toast in the export;
-- kept our existing "Smash" name.
UPDATE public.meal_templates SET
  description = 'Multigrain Sourdough bread, guacamole, feta cheese, microgreens, 3 types of seeds, pomegranate, tomato confit.',
  kcal = 363,
  protein = 11.9
WHERE id = 'avocado-smash-toast';
