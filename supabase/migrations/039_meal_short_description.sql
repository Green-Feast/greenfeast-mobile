-- Menu tab cards swap their kcal/protein badges for a short description.
-- description itself is bimodal: 12 meals have ~50-90 char marketing copy
-- (003_seed.sql, fine as-is), 9 were overwritten by 028 with 130-290 char
-- POS ingredient dumps that truncate badly on a 2-line card clamp. This adds
-- a short_description column rather than overwriting description (which the
-- detail modal keeps showing in full — the ingredient lists are genuinely
-- useful there), backfills the 12 short ones verbatim, and hand-writes the
-- other 9 (not auto-truncated — a clipped ingredient list mid-word reads
-- badly; these were written from the real descriptions, ~60-70 chars each).

ALTER TABLE public.meal_templates ADD COLUMN IF NOT EXISTS short_description TEXT;

UPDATE public.meal_templates
SET short_description = description
WHERE description IS NOT NULL AND length(description) <= 90;

UPDATE public.meal_templates SET short_description = CASE id
  WHEN 'avocado-smash-toast'      THEN 'Sourdough toast, guacamole, feta, microgreens, and pomegranate'
  WHEN 'bbq-protein-wrap'         THEN 'Tandoori paneer, beetroot tortilla, and house tandoori spread'
  WHEN 'caesar-power-salad'       THEN 'Romaine, herbed croutons, parmesan, and house Caesar dressing'
  WHEN 'smoky-chipotle-wrap'      THEN 'Sautéed paneer, avocado, corn, jalapeños, and chipotle spread'
  WHEN 'thai-zen-bowl'            THEN 'Chilli tofu, brown rice, green papaya, and house peanut dressing'
  WHEN 'japanese-umami-bowl'      THEN 'Soba noodles, grilled tofu/paneer, bok choy, and peanut dressing'
  WHEN 'mexican-fiesta-bowl'      THEN 'Herbed brown rice, avocado, pineapple salsa, and chipotle dressing'
  WHEN 'italian-harvest-bowl'     THEN 'Wheat pasta, sautéed mushroom, zucchini, feta, and house dressing'
  WHEN 'mediterranean-mezze-bowl' THEN 'Couscous tabbouleh, paneer, roasted beetroot, and tahini dressing'
END
WHERE id IN (
  'avocado-smash-toast', 'bbq-protein-wrap', 'caesar-power-salad', 'smoky-chipotle-wrap',
  'thai-zen-bowl', 'japanese-umami-bowl', 'mexican-fiesta-bowl', 'italian-harvest-bowl',
  'mediterranean-mezze-bowl'
);

NOTIFY pgrst, 'reload schema';
