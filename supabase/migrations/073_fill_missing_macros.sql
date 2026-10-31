-- ============================================================
-- GreenFeast — Migration 073: Fill missing macros on current meals
--
-- Source: "Final Source of Truth (Menu- all SKU) - SKU.csv" (kcal, protein,
-- carbs, fats, fibre per item).
--
-- Only NULLs are filled (COALESCE keeps any value already stored), so nothing
-- an admin has set is overwritten. Only active meals the CSV lists with at
-- least one figure are touched. Blank cells in the CSV stay NULL — wraps,
-- toasts and paninis have no carbs/fat in the export, and nothing is estimated.
-- Items not in the CSV (Burmese Khaosuey, Chef's Special, Peri Peri Paneer
-- Bowl, Tofu burji wrap, Orange Quinoa Cake, Lebanese Panini) are untouched.
-- ============================================================

UPDATE public.meal_templates m SET
  kcal    = COALESCE(m.kcal,    v.kcal),
  protein = COALESCE(m.protein, v.protein),
  carbs   = COALESCE(m.carbs,   v.carbs),
  fat     = COALESCE(m.fat,     v.fat),
  fibre   = COALESCE(m.fibre,   v.fibre)
FROM (VALUES
  --  id                          kcal  protein carbs  fat   fibre
  -- Power Bowls
  ('mexican-fiesta-bowl',          490,  19,     60,    24,   12),
  ('mediterranean-bliss-bowl',     510,  23,     50,    22,   14),
  ('umami-soba-bowl',              500,  20,     45,    22,   12),
  ('italian-harvest-bowl',         530,  18,     46,    22,   12),
  ('quinoa-buddha-bowl',           500,  21,     50,    21,   11),
  ('thai-zen-bowl',                480,  18,     43,    20,   13),
  ('burrito-bowl',                 550,  24,     65,    18,   13),
  ('avo-protein-bowl',             510,  21,     50,    19,   11),
  -- Wraps (CSV has no carbs/fat)
  ('bbq-protein-wrap',             525,  19,     NULL,  NULL,  6),
  ('plant-protein-soya-wrap',      515,  23,     NULL,  NULL, 10),
  ('smoky-chipotle-wrap',          540,  20,     NULL,  NULL,  9),
  -- Open toasts (CSV has no carbs/fat)
  ('avo-feta-toast',               325,   8,     NULL,  NULL,  7),
  ('earthy-hummus-toast',          345,  15,     NULL,  NULL,  7),
  -- Paninis (CSV has no carbs/fat)
  ('peri-peri-paneer-panini',      400,  15,     NULL,  NULL,  5),
  ('green-goddess-panini',         500,  19,     NULL,  NULL,  6),
  ('plant-protein-panini',         395,  18,     NULL,  NULL,  7),
  -- Functional smoothies
  ('blue-mind',                    190,   7,     31,     5,    4),
  ('going-nuts',                   235,   9,     31,     9,    5),
  ('avo-clarity',                  280,   5,     45,    12,    9),
  ('purple-pulse',                 220,   8,     35,     7,    5),
  ('cocoa-core',                   340,   9,     45,    15,    5),
  ('berry-bloom',                  195,   6,     34,     7,    6)
) AS v(id, kcal, protein, carbs, fat, fibre)
WHERE m.id = v.id
  AND m.is_active;
