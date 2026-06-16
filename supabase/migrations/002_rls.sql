-- ============================================================
-- GreenFeast — Migration 002: Row Level Security Policies
-- Run AFTER 001_schema.sql
-- ============================================================

-- Enable RLS on every table
ALTER TABLE public.users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dietary_profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.addresses            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_partners    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batches              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_templates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingredients          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.template_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.addons               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_addons  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_ingredients    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_addons         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_attempts         ENABLE ROW LEVEL SECURITY;


-- ── Public catalogue (anyone can browse menu before login) ────────────────────
CREATE POLICY "public_read_plans"
  ON public.plans FOR SELECT USING (true);

CREATE POLICY "public_read_meal_templates"
  ON public.meal_templates FOR SELECT USING (true);

CREATE POLICY "public_read_addons"
  ON public.addons FOR SELECT USING (true);

CREATE POLICY "public_read_ingredients"
  ON public.ingredients FOR SELECT USING (true);

CREATE POLICY "public_read_template_ingredients"
  ON public.template_ingredients FOR SELECT USING (true);

CREATE POLICY "public_read_batches"
  ON public.batches FOR SELECT USING (true);


-- ── users ────────────────────────────────────────────────────────────────────
CREATE POLICY "users_select_own"
  ON public.users FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "users_insert_own"
  ON public.users FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "users_update_own"
  ON public.users FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);


-- ── dietary_profiles ─────────────────────────────────────────────────────────
CREATE POLICY "dietary_profiles_own"
  ON public.dietary_profiles FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ── addresses ────────────────────────────────────────────────────────────────
CREATE POLICY "addresses_own"
  ON public.addresses FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ── subscriptions ─────────────────────────────────────────────────────────────
CREATE POLICY "subscriptions_select_own"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "subscriptions_update_own"
  ON public.subscriptions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ── subscription_schedule ────────────────────────────────────────────────────
CREATE POLICY "subscription_schedule_own"
  ON public.subscription_schedule FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.subscriptions s
      WHERE s.id = subscription_id AND s.user_id = auth.uid()
    )
  );


-- ── subscription_addons ───────────────────────────────────────────────────────
CREATE POLICY "subscription_addons_own"
  ON public.subscription_addons FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.subscriptions s
      WHERE s.id = subscription_id AND s.user_id = auth.uid()
    )
  );


-- ── orders ────────────────────────────────────────────────────────────────────
CREATE POLICY "orders_select_own"
  ON public.orders FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "orders_update_own"
  ON public.orders FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ── order_ingredients ─────────────────────────────────────────────────────────
CREATE POLICY "order_ingredients_select_own"
  ON public.order_ingredients FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_id AND o.user_id = auth.uid()
    )
  );


-- ── order_addons ──────────────────────────────────────────────────────────────
CREATE POLICY "order_addons_own"
  ON public.order_addons FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_id AND o.user_id = auth.uid()
    )
  );


-- ── wallets ───────────────────────────────────────────────────────────────────
CREATE POLICY "wallets_select_own"
  ON public.wallets FOR SELECT
  USING (auth.uid() = user_id);


-- ── wallet_transactions ───────────────────────────────────────────────────────
CREATE POLICY "wallet_transactions_select_own"
  ON public.wallet_transactions FOR SELECT
  USING (auth.uid() = user_id);


-- ── payments ──────────────────────────────────────────────────────────────────
CREATE POLICY "payments_select_own"
  ON public.payments FOR SELECT
  USING (auth.uid() = user_id);


-- ── notifications ─────────────────────────────────────────────────────────────
CREATE POLICY "notifications_own"
  ON public.notifications FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ── delivery_partners — no client access (admin/service role only) ───────────
-- No policies created → only service role key can touch this table.
-- Document URLs point to a private Supabase Storage bucket.


-- ── otp_attempts — no client access (service role only) ──────────────────────
-- No policies created → only service role key can touch this table.


-- ── audit_log — no client access (service role only) ─────────────────────────
-- No policies created → only service role key can touch this table.


-- ─────────────────────────────────────────────────────────────────────────────
-- NOTE: The admin Next.js app and all Supabase Edge Functions use the
-- SERVICE ROLE KEY, which bypasses RLS entirely. Never expose that key
-- to the browser or the Expo app.
-- ─────────────────────────────────────────────────────────────────────────────
