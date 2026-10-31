-- ============================================================
-- GreenFeast — Migration 074: CSV is the source of truth + estimates for gaps
--
-- 1. The menu CSV ("Final Source of Truth (Menu- all SKU) - SKU.csv") wins:
--    wherever it states a figure for a current meal, that figure is stored,
--    replacing whatever was there (only bbq-protein-wrap differed: 500 kcal /
--    8 g fibre -> 525 kcal / 6 g fibre).
--
-- 2. Everything still NULL on a current meal is ESTIMATED (not measured).
--    Estimates are built to be consistent with each meal's stored kcal and
--    protein (about 4 kcal/g protein + 4 kcal/g carbs + 9 kcal/g fat) and are
--    only written into NULL cells. Replace them when the kitchen supplies real
--    numbers. Estimated: carbs + fat for wraps, toasts, paninis and the
--    tropical fruit bowl; the full set for items missing from the CSV
--    (Burmese Khaosuey, Chef's Special, Peri Peri Paneer Bowl, Tofu burji
--    wrap, Lebanese Panini, Orange Quinoa Cake); and protein/carbs/fat/fibre
--    for the four coffees (300 ml).
-- ============================================================

-- 1. CSV wins (NULL in this list = the CSV is blank, keep what's stored)
UPDATE public.meal_templates m SET
  kcal    = COALESCE(v.kcal,    m.kcal),
  protein = COALESCE(v.protein, m.protein),
  carbs   = COALESCE(v.carbs,   m.carbs),
  fat     = COALESCE(v.fat,     m.fat),
  fibre   = COALESCE(v.fibre,   m.fibre)
FROM (VALUES
  ('mexican-fiesta-bowl',          490,  19,     60,    24,   12),
  ('mediterranean-bliss-bowl',     510,  23,     50,    22,   14),
  ('umami-soba-bowl',              500,  20,     45,    22,   12),
  ('italian-harvest-bowl',         530,  18,     46,    22,   12),
  ('quinoa-buddha-bowl',           500,  21,     50,    21,   11),
  ('thai-zen-bowl',                480,  18,     43,    20,   13),
  ('burrito-bowl',                 550,  24,     65,    18,   13),
  ('avo-protein-bowl',             510,  21,     50,    19,   11),
  ('bbq-protein-wrap',             525,  19,     NULL,  NULL,  6),
  ('plant-protein-soya-wrap',      515,  23,     NULL,  NULL, 10),
  ('smoky-chipotle-wrap',          540,  20,     NULL,  NULL,  9),
  ('avo-feta-toast',               325,   8,     NULL,  NULL,  7),
  ('earthy-hummus-toast',          345,  15,     NULL,  NULL,  7),
  ('peri-peri-paneer-panini',      400,  15,     NULL,  NULL,  5),
  ('green-goddess-panini',         500,  19,     NULL,  NULL,  6),
  ('plant-protein-panini',         395,  18,     NULL,  NULL,  7),
  ('blue-mind',                    190,   7,     31,     5,    4),
  ('going-nuts',                   235,   9,     31,     9,    5),
  ('avo-clarity',                  280,   5,     45,    12,    9),
  ('purple-pulse',                 220,   8,     35,     7,    5),
  ('cocoa-core',                   340,   9,     45,    15,    5),
  ('berry-bloom',                  195,   6,     34,     7,    6),
  ('iced-cold-brew',                 5,   NULL,  NULL,  NULL, NULL),
  ('vietnamese-cold-brew',         145,   NULL,  NULL,  NULL, NULL),
  ('ginger-ale-cold-brew',          60,   NULL,  NULL,  NULL, NULL),
  ('iced-latte',                    85,   NULL,  NULL,  NULL, NULL)
) AS v(id, kcal, protein, carbs, fat, fibre)
WHERE m.id = v.id AND m.is_active;

-- 2. Estimates, NULL cells only
UPDATE public.meal_templates m SET
  kcal    = COALESCE(m.kcal,    e.kcal),
  protein = COALESCE(m.protein, e.protein),
  carbs   = COALESCE(m.carbs,   e.carbs),
  fat     = COALESCE(m.fat,     e.fat),
  fibre   = COALESCE(m.fibre,   e.fibre)
FROM (VALUES
  --  id                          kcal  protein carbs  fat   fibre
  ('bbq-protein-wrap',             525,  19,     63,    22,    6),
  ('plant-protein-soya-wrap',      515,  23,     65,    18,   10),
  ('smoky-chipotle-wrap',          540,  20,     65,    22,    9),
  ('tofu-burji-wrap',              480,  18,     57,    20,    9),
  ('avo-feta-toast',               325,   8,     33,    18,    7),
  ('earthy-hummus-toast',          345,  15,     38,    15,    7),
  ('peri-peri-paneer-panini',      400,  15,     47,    17,    5),
  ('green-goddess-panini',         500,  19,     52,    24,    6),
  ('plant-protein-panini',         395,  18,     49,    14,    7),
  ('lebanese-panini',              500,  21,     59,    20,   11),
  ('peri-peri-paneer-bowl',        495,  18,     56,    22,   10),
  ('burmese-khaosuey',             510,  16,     62,    22,    8),
  ('chefs-special',                500,  20,     55,    22,   11),
  ('tropical-fruit-bowl',          190, 3.5,     40,     2,    6),
  ('orange-quinoa-cake',           280,   5,     38,    12,    3),
  ('iced-cold-brew',                 5,   0,      1,     0,    0),
  ('vietnamese-cold-brew',         145,   3,     24,     4,    0),
  ('ginger-ale-cold-brew',          60,   0,     15,     0,    0),
  ('iced-latte',                    85,   2,     14,   2.5,    1)
) AS e(id, kcal, protein, carbs, fat, fibre)
WHERE m.id = e.id AND m.is_active;
