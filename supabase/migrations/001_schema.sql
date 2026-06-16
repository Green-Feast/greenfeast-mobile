-- ============================================================
-- GreenFeast — Migration 001: Full Schema
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- updated_at trigger (defined once, reused by all tables)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- 1. users (extends auth.users via same UUID)
CREATE TABLE public.users (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone           TEXT UNIQUE NOT NULL,
  name            TEXT,
  expo_push_token TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- 2. dietary_profiles
CREATE TABLE public.dietary_profiles (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  allergens            TEXT[]  DEFAULT '{}',
  dietary_preference   TEXT,   -- 'vegan', 'vegetarian', 'non-veg'
  free_text            TEXT,
  health_goal          TEXT,
  age                  TEXT,
  weight               TEXT,
  height               TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at           TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (user_id)
);
CREATE TRIGGER dietary_profiles_updated_at
  BEFORE UPDATE ON public.dietary_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- 3. addresses
CREATE TABLE public.addresses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('office', 'residence')),
  line1       TEXT NOT NULL,
  city        TEXT NOT NULL,
  pincode     TEXT NOT NULL,
  landmark    TEXT,
  time_window TEXT NOT NULL,
  is_default  BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL
);


-- 4. plans (subscription tiers)
CREATE TABLE public.plans (
  id           TEXT PRIMARY KEY,   -- 'trial', 'plan15', 'plan30'
  name         TEXT    NOT NULL,
  meals_total  INTEGER NOT NULL,
  days_per_week INTEGER NOT NULL,
  base_price   INTEGER NOT NULL,   -- in paise (₹1 = 100 paise)
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL
);


-- 5. delivery_partners (people who carry out deliveries)
CREATE TABLE public.delivery_partners (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  phone              TEXT NOT NULL,
  alternate_phone    TEXT,
  aadhaar_number     TEXT,
  aadhaar_doc_url    TEXT,
  pan_number         TEXT,
  pan_doc_url        TEXT,
  dl_number          TEXT,
  dl_doc_url         TEXT,
  vehicle_rc_number  TEXT,
  vehicle_rc_doc_url TEXT,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  notes              TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at         TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE TRIGGER delivery_partners_updated_at
  BEFORE UPDATE ON public.delivery_partners
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- 6. batches (a delivery run: area + time slot + assigned partners)
CREATE TABLE public.batches (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT NOT NULL,
  area                 TEXT,
  time_window          TEXT NOT NULL CHECK (time_window IN ('morning', 'noon', 'evening')),
  primary_partner_id   UUID REFERENCES public.delivery_partners(id) ON DELETE SET NULL,
  secondary_partner_id UUID REFERENCES public.delivery_partners(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at           TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE TRIGGER batches_updated_at
  BEFORE UPDATE ON public.batches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- 6. meal_templates (menu catalogue)
CREATE TABLE public.meal_templates (
  id          TEXT PRIMARY KEY,   -- slug e.g. 'thai-zen-bowl'
  name        TEXT    NOT NULL,
  category    TEXT    NOT NULL CHECK (category IN ('bowl', 'wrap', 'salad', 'toast', 'smoothie')),
  description TEXT,
  price       INTEGER NOT NULL,   -- in paise
  kcal        INTEGER,
  protein     NUMERIC(5,1),
  carbs       NUMERIC(5,1),
  fat         NUMERIC(5,1),
  image_url   TEXT,
  tags        TEXT[]  DEFAULT '{}',
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL
);


-- 7. ingredients (master list)
CREATE TABLE public.ingredients (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  unit       TEXT NOT NULL,   -- 'g', 'ml', 'pieces'
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);


-- 8. template_ingredients (what goes into each meal)
CREATE TABLE public.template_ingredients (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_template_id TEXT NOT NULL REFERENCES public.meal_templates(id) ON DELETE CASCADE,
  ingredient_id    UUID NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  quantity         NUMERIC(8,2) NOT NULL,
  UNIQUE (meal_template_id, ingredient_id)
);


-- 9. addons
CREATE TABLE public.addons (
  id             TEXT PRIMARY KEY,   -- 'smoothie', 'exotic-fruits', 'cheese'
  name           TEXT    NOT NULL,
  description    TEXT,
  price_per_meal INTEGER NOT NULL,   -- in paise
  is_active      BOOLEAN DEFAULT TRUE,
  created_at     TIMESTAMPTZ DEFAULT NOW() NOT NULL
);


-- 10. subscriptions
CREATE TABLE public.subscriptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  plan_id               TEXT NOT NULL REFERENCES public.plans(id),
  batch_id              UUID REFERENCES public.batches(id),
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'active', 'paused', 'cancelled', 'expired')),
  meals_per_day         INTEGER NOT NULL DEFAULT 1,
  delivery_mode         TEXT NOT NULL DEFAULT 'opt-out'
                          CHECK (delivery_mode IN ('opt-in', 'opt-out')),
  start_date            DATE,
  end_date              DATE,
  pause_from            DATE,
  pause_until           DATE,
  deliveries_remaining  INTEGER NOT NULL DEFAULT 0,
  special_notes         TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at            TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX idx_subscriptions_user   ON public.subscriptions (user_id);
CREATE INDEX idx_subscriptions_status ON public.subscriptions (status);
CREATE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- 11. subscription_schedule (which day of week → which meal)
CREATE TABLE public.subscription_schedule (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id  UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  day_of_week      TEXT NOT NULL CHECK (day_of_week IN ('Mon','Tue','Wed','Thu','Fri','Sat','Sun')),
  meal_template_id TEXT NOT NULL REFERENCES public.meal_templates(id),
  UNIQUE (subscription_id, day_of_week)
);


-- 12. subscription_addons (add-ons that apply to every delivery)
CREATE TABLE public.subscription_addons (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  addon_id        TEXT NOT NULL REFERENCES public.addons(id),
  sub_option      TEXT,   -- e.g. 'Feta', 'Parmesan', 'Cheddar' for cheese
  UNIQUE (subscription_id, addon_id)
);


-- 13. orders (one row per delivery instance)
CREATE TABLE public.orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES public.users(id),
  subscription_id  UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  meal_template_id TEXT NOT NULL REFERENCES public.meal_templates(id),
  batch_id         UUID REFERENCES public.batches(id),
  address_id       UUID REFERENCES public.addresses(id),
  delivery_date    DATE NOT NULL,
  status           TEXT NOT NULL DEFAULT 'scheduled'
                     CHECK (status IN ('scheduled','confirmed','preparing','delivered','cancelled','skipped')),
  special_notes    TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at       TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (subscription_id, delivery_date)
);
CREATE INDEX idx_orders_user_date    ON public.orders (user_id, delivery_date);
CREATE INDEX idx_orders_delivery_date ON public.orders (delivery_date);
CREATE INDEX idx_orders_batch        ON public.orders (batch_id, delivery_date);
CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- 14. order_ingredients (ingredient snapshot at order creation)
CREATE TABLE public.order_ingredients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  ingredient_id   UUID NOT NULL REFERENCES public.ingredients(id),
  ingredient_name TEXT NOT NULL,   -- denormalized; survives ingredient renames
  quantity        NUMERIC(8,2) NOT NULL,
  unit            TEXT NOT NULL
);


-- 15. order_addons
CREATE TABLE public.order_addons (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  addon_id   TEXT NOT NULL REFERENCES public.addons(id),
  sub_option TEXT,
  UNIQUE (order_id, addon_id)
);


-- 16. wallets
CREATE TABLE public.wallets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  balance    INTEGER NOT NULL DEFAULT 0,   -- in paise
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (user_id)
);
CREATE TRIGGER wallets_updated_at
  BEFORE UPDATE ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- 17. wallet_transactions
CREATE TABLE public.wallet_transactions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id    UUID NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.users(id),
  type         TEXT NOT NULL CHECK (type IN ('credit', 'debit')),
  amount       INTEGER NOT NULL,   -- in paise
  reason       TEXT,
  reference_id TEXT,   -- order_id or payment_id
  created_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX idx_wallet_transactions_user ON public.wallet_transactions (user_id);


-- 18. payments
CREATE TABLE public.payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES public.users(id),
  subscription_id     UUID REFERENCES public.subscriptions(id),
  razorpay_order_id   TEXT UNIQUE,
  razorpay_payment_id TEXT UNIQUE,
  amount              INTEGER NOT NULL,   -- in paise
  status              TEXT NOT NULL DEFAULT 'created'
                        CHECK (status IN ('created','paid','failed','refunded')),
  created_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE TRIGGER payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- 19. notifications
CREATE TABLE public.notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  type       TEXT NOT NULL,   -- 'order_update', 'payment', 'subscription'
  read       BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);


-- 20. audit_log (admin actions)
CREATE TABLE public.audit_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   TEXT,
  action     TEXT NOT NULL,
  table_name TEXT,
  record_id  TEXT,
  old_value  JSONB,
  new_value  JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);


-- 21. otp_attempts (short-lived, used by send-otp / verify-otp edge functions)
CREATE TABLE public.otp_attempts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      TEXT NOT NULL,
  otp        TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  verified   BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX idx_otp_phone ON public.otp_attempts (phone, expires_at);
