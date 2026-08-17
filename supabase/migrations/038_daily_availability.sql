-- Per-calendar-date availability for meals/add-ons, and 2 admin-picked
-- "Today's Special" dishes. Nothing dated existed before this — weekly_menu
-- is a weekday template with no date column.
--
-- Row absence means available: the read rule everywhere is
-- "row absent OR is_available = true". This makes the admin save a pure
-- upsert on the composite PK with no delete/diff pass, and an accidental
-- row is harmless either way.
--
-- Three separate tables rather than one polymorphic table — a single table
-- covering both meals and add-ons would need two nullable FKs + a CHECK
-- (an exclusive arc), giving up real referential integrity to save one
-- small table.

CREATE TABLE IF NOT EXISTS public.meal_availability (
  for_date         DATE        NOT NULL,
  meal_template_id TEXT        NOT NULL REFERENCES public.meal_templates(id) ON DELETE CASCADE,
  is_available     BOOLEAN     NOT NULL DEFAULT TRUE,
  note             TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (for_date, meal_template_id)
);

CREATE TABLE IF NOT EXISTS public.addon_availability (
  for_date     DATE        NOT NULL,
  addon_id     TEXT        NOT NULL REFERENCES public.addons(id) ON DELETE CASCADE,
  is_available BOOLEAN     NOT NULL DEFAULT TRUE,
  note         TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (for_date, addon_id)
);

-- Specials are date-scoped, not slot-scoped, matching how Home's "Today's
-- Special" section already renders — one pair for the whole date, not a
-- lunch pair + a dinner pair.
CREATE TABLE IF NOT EXISTS public.daily_specials (
  for_date         DATE        NOT NULL,
  sort_order       SMALLINT    NOT NULL CHECK (sort_order IN (1, 2)),
  meal_template_id TEXT        NOT NULL REFERENCES public.meal_templates(id) ON DELETE CASCADE,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (for_date, sort_order),
  UNIQUE (for_date, meal_template_id)
);

ALTER TABLE public.meal_availability  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.addon_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_specials     ENABLE ROW LEVEL SECURITY;

-- Public read, matching the meal_templates/addons precedent (002_rls.sql) —
-- the app browses these pre-login.
CREATE POLICY "public_read_meal_availability"
  ON public.meal_availability  FOR SELECT USING (true);
CREATE POLICY "public_read_addon_availability"
  ON public.addon_availability FOR SELECT USING (true);
CREATE POLICY "public_read_daily_specials"
  ON public.daily_specials     FOR SELECT USING (true);

GRANT SELECT ON public.meal_availability, public.addon_availability, public.daily_specials
  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.meal_availability, public.addon_availability, public.daily_specials
  TO service_role;

NOTIFY pgrst, 'reload schema';
