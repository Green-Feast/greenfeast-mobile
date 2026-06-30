-- Migration 025: Add carbs and fat macro columns to meal_templates.
-- kcal and protein already exist. Adding carbs + fat so the My Plan hero card
-- can display a full macro chip row (Protein | Carbs | Fat) per slot.

ALTER TABLE public.meal_templates
  ADD COLUMN IF NOT EXISTS carbs numeric,
  ADD COLUMN IF NOT EXISTS fat   numeric;

NOTIFY pgrst, 'reload schema';
