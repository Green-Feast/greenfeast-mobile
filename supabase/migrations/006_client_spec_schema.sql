-- ============================================================
-- GreenFeast — Migration 006: Client Spec Schema Updates
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================


-- 1. users — track whether onboarding is fully complete
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS onboarded BOOLEAN NOT NULL DEFAULT FALSE;


-- 2. dietary_profiles — add health profile + detailed dietary customisation columns
ALTER TABLE public.dietary_profiles
  ADD COLUMN IF NOT EXISTS occupation         TEXT,
  ADD COLUMN IF NOT EXISTS exercise_type      TEXT[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS exercise_frequency TEXT,
  ADD COLUMN IF NOT EXISTS protein_preference TEXT[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS base_avoidance     TEXT[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS veggie_avoidance   TEXT[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS spice_preference   TEXT,   -- 'mild' | 'medium' | 'spicy'
  ADD COLUMN IF NOT EXISTS dressing_preference TEXT;  -- 'mixed-in' | 'on-the-side'


-- 3. subscriptions — add plan identity + per-slot meal counts
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS plan_name    TEXT,
  ADD COLUMN IF NOT EXISTS menu_type    TEXT CHECK (menu_type IN ('M1', 'M2')),
  ADD COLUMN IF NOT EXISTS meals_lunch  INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS meals_dinner INTEGER NOT NULL DEFAULT 0;


-- 4. addresses — fix type constraint and make time_window optional
--    Old constraint: type IN ('office', 'residence')
--    New constraint: type IN ('home', 'office', 'other')
ALTER TABLE public.addresses
  DROP CONSTRAINT IF EXISTS addresses_type_check;

ALTER TABLE public.addresses
  ADD CONSTRAINT addresses_type_check CHECK (type IN ('home', 'office', 'other'));

-- time_window belongs on batches, not addresses — make it optional
ALTER TABLE public.addresses
  ALTER COLUMN time_window DROP NOT NULL;


-- 5. orders — add meal_slot so one day can have both lunch + dinner deliveries
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS meal_slot TEXT NOT NULL DEFAULT 'lunch'
    CHECK (meal_slot IN ('lunch', 'dinner'));

-- Drop old unique constraint that only covers (subscription_id, delivery_date)
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_subscription_id_delivery_date_key;

-- New unique constraint allows one lunch + one dinner per day
ALTER TABLE public.orders
  ADD CONSTRAINT orders_subscription_delivery_slot_unique
    UNIQUE (subscription_id, delivery_date, meal_slot);


-- 6. questionnaire_responses — stores goal questionnaire answers + derived plan
CREATE TABLE IF NOT EXISTS public.questionnaire_responses (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  health_goal         TEXT NOT NULL,  -- 'build-muscle' | 'lose-weight' | 'improve-wellness' | 'boost-energy'
  q1_answer           TEXT,
  q2_answer           TEXT,           -- only used in lose-weight path
  derived_menu        TEXT CHECK (derived_menu IN ('M1', 'M2')),
  derived_addons      TEXT[]  DEFAULT '{}',  -- addon IDs e.g. ['extra-protein', 'smoothie']
  derived_constraints TEXT[]  DEFAULT '{}',
  created_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (user_id)
);

CREATE TRIGGER questionnaire_responses_updated_at
  BEFORE UPDATE ON public.questionnaire_responses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
