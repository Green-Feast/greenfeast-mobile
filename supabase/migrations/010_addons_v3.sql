-- ============================================================
-- GreenFeast — Migration 010: Stack Logic v3 data
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor)
-- All prices stored in PAISE (₹1 = 100 paise)
-- ============================================================

-- ── Add-ons (v3) ───────────────────────────────────────────────────────────────
-- The recommendation engine (src/lib/recommendation.ts) references add-on IDs
-- that must exist in this table. The original seed (003) only had
-- smoothie / exotic-fruits / cheese; the v3 stack logic is built around
-- extra-protein and seeds. Idempotent upsert so this can be re-run safely.

INSERT INTO public.addons (id, name, description, price_per_meal, is_active) VALUES
  ('extra-protein',  'Extra Protein',     'Paneer or tofu based',           4500, TRUE),
  ('seeds',          'Seeds',             'Gut health, satiety, fibre',     3000, TRUE),
  ('extra-dressing', 'Extra Dressing',    NULL,                             2000, TRUE),
  ('exotic-fruits',  'Exotic Cut Fruits', 'Satiety, clean eating',          9900, TRUE),
  ('smoothie',       'Smoothie',          'Berry Banana / Watermelon Mint / Creamy Avocado', 14900, TRUE),
  ('cheese',         'Extra Cheese',      'Feta / Parmesan / Cheddar',      4500, TRUE)
ON CONFLICT (id) DO UPDATE SET
  name           = EXCLUDED.name,
  description    = EXCLUDED.description,
  price_per_meal = EXCLUDED.price_per_meal,
  is_active      = EXCLUDED.is_active;


-- ── dietary_profiles: format preference ─────────────────────────────────────────
-- Collected on the post-payment customisation screen (Bowls / Wraps / Both).
ALTER TABLE public.dietary_profiles
  ADD COLUMN IF NOT EXISTS format_preference TEXT;  -- 'bowls' | 'wraps' | 'both'
