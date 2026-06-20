-- Weekly menu: global M1/M2 menus by day of week (0=Mon, 6=Sun, matching kitchen-client convention)
-- The instantiate-orders function sources meals from here instead of subscription_schedule
-- Admin edits these; changes propagate to un-swapped future orders

CREATE TABLE public.weekly_menu (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_type        VARCHAR(2)   NOT NULL CHECK (menu_type IN ('M1', 'M2')),
  day_of_week      SMALLINT     NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  meal_slot        VARCHAR(20)  NOT NULL DEFAULT 'lunch' CHECK (meal_slot IN ('lunch', 'dinner')),
  meal_template_id UUID         REFERENCES meal_templates(id) ON DELETE SET NULL,
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (menu_type, day_of_week, meal_slot)
);

-- Track whether an order was manually swapped (user or admin) so menu edits don't clobber it
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS is_customized BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for fast lookup during instantiate-orders
CREATE INDEX IF NOT EXISTS idx_weekly_menu_lookup ON weekly_menu (menu_type, day_of_week, meal_slot);

-- Allow service_role (edge functions + server actions) to read/write this table
GRANT SELECT, INSERT, UPDATE, DELETE ON public.weekly_menu TO service_role;

-- RLS enabled — service_role bypasses it automatically
ALTER TABLE public.weekly_menu ENABLE ROW LEVEL SECURITY;

-- Notify PostgREST to reload its schema cache
NOTIFY pgrst, 'reload schema';
