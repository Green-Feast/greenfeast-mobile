-- ============================================================
-- Migration 041: Admin-editable menu catalogue
--
-- Makes categories a real table (previously a CHECK constraint on
-- meal_templates.category) and adds the visibility/subscription-availability
-- flags the admin Menu page needs. Every default is chosen so existing dishes
-- keep behaving exactly as they do today until an admin changes something.
-- ============================================================

-- 1. categories table, seeded from the current hardcoded values in
--    src/constants/categories.ts (CATEGORIES / CATEGORY_EMOJIS / CATEGORY_IMAGES)
--    so nothing regresses visually.
CREATE TABLE public.categories (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  emoji      TEXT,
  image_url  TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.categories (id, name, sort_order, emoji, image_url) VALUES
  ('bowl',     'Bowl',     1, '🥗', 'https://amwwjcwoumhbdxaxvexj.supabase.co/storage/v1/object/public/category-images/bowl_category.webp'),
  ('wrap',     'Wrap',     2, '🌯', 'https://amwwjcwoumhbdxaxvexj.supabase.co/storage/v1/object/public/category-images/wrap_category.webp'),
  ('salad',    'Salad',    3, '🥙', 'https://amwwjcwoumhbdxaxvexj.supabase.co/storage/v1/object/public/category-images/salad_category.webp'),
  ('toast',    'Toast',    4, '🍞', 'https://amwwjcwoumhbdxaxvexj.supabase.co/storage/v1/object/public/category-images/toast_category.webp'),
  ('smoothie', 'Smoothie', 5, '🥤', 'https://amwwjcwoumhbdxaxvexj.supabase.co/storage/v1/object/public/category-images/smoothie_category.webp');

-- 2. Drop the CHECK constraint, replace with a real FK. RESTRICT (not CASCADE
--    or SET NULL) so a category with dishes in it can never be deleted out
--    from under them — same reasoning as the meal_templates delete guard
--    below: silent holes in the menu are worse than a blocked action.
ALTER TABLE public.meal_templates DROP CONSTRAINT meal_templates_category_check;
ALTER TABLE public.meal_templates
  ADD CONSTRAINT meal_templates_category_fkey
    FOREIGN KEY (category) REFERENCES public.categories(id) ON DELETE RESTRICT;

-- 3. is_active was nullable — a NULL silently vanishes a dish everywhere
--    (every query does .eq('is_active', true)), which is surprising for an
--    admin toggling it. Backfill and lock it down.
UPDATE public.meal_templates SET is_active = TRUE WHERE is_active IS NULL;
ALTER TABLE public.meal_templates
  ALTER COLUMN is_active SET NOT NULL,
  ALTER COLUMN is_active SET DEFAULT TRUE;

-- 4. The two flags the admin Menu page controls, plus the image/version
--    columns the upload pipeline and cache-busting need. Defaults keep every
--    existing dish visible and orderable exactly as before.
ALTER TABLE public.meal_templates
  ADD COLUMN menu_visible        BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN subscription_valid  BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN thumb_url           TEXT,
  ADD COLUMN blur_data_url       TEXT,
  ADD COLUMN updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TRIGGER meal_templates_updated_at
  BEFORE UPDATE ON public.meal_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 5. RLS on categories — same posture as meal_templates (002_rls.sql:35):
--    public read, service_role-only write.
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_categories" ON public.categories FOR SELECT USING (true);
GRANT SELECT ON public.categories TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO service_role;

NOTIFY pgrst, 'reload schema';
