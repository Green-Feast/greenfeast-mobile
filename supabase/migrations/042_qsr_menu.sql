-- ============================================================
-- Migration 042: QSR menu categories + fibre macro
--
-- Adds the two categories the new final menu introduces (Panini, Coffee),
-- and a fibre column — the new menu gives exact fibre grams per dish where
-- carbs/fat aren't provided at all. MacroRow (src/components/MacroRow.tsx)
-- already accepts a `fibre` prop and silently omits it when null, so this
-- is purely additive: existing dishes with fibre=NULL render exactly as
-- before.
-- ============================================================

INSERT INTO public.categories (id, name, sort_order, emoji) VALUES
  ('panini', 'Panini', 6, '🥪'),
  ('coffee', 'Coffee', 7, '☕');

ALTER TABLE public.meal_templates ADD COLUMN fibre NUMERIC(5,1);

NOTIFY pgrst, 'reload schema';
