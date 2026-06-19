-- Weekly menu: global M1/M2 menus by day of week
-- The instantiate-orders function sources meals from here instead of subscription_schedule
-- Admin edits these; changes propagate to un-swapped future orders

CREATE TABLE public.weekly_menu (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_type CHECK (menu_type IN ('M1', 'M2')) NOT NULL,
  day_of_week SMALLINT CHECK (day_of_week >= 0 AND day_of_week <= 6) NOT NULL, -- 0=Mon, 6=Sun
  meal_slot VARCHAR(20) CHECK (meal_slot IN ('lunch', 'dinner')) NOT NULL DEFAULT 'lunch',
  meal_template_id UUID REFERENCES meal_templates(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(menu_type, day_of_week, meal_slot)
);

-- orders.is_customized: set to true if user or admin swaps, prevents menu edits from clobbering the meal
ALTER TABLE public.orders ADD COLUMN is_customized BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for fast lookup during instantiate-orders
CREATE INDEX idx_weekly_menu_lookup ON weekly_menu(menu_type, day_of_week, meal_slot);

-- Grant to service_role so admin Kitchen tab + instantiate-orders can read/write
GRANT SELECT, INSERT, UPDATE, DELETE ON weekly_menu TO service_role;
ALTER TABLE weekly_menu ENABLE ROW LEVEL SECURITY;

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
