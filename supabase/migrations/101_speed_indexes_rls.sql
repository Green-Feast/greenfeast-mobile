-- 101: Speed — missing indexes and once-per-query RLS (2026-11-20).
--
-- Diagnosis (pg_stat_statements / pg_stat_user_tables, 20 Nov): the database
-- itself is quick (most queries a few ms, 100 % cache hit, 13 of 60
-- connections), but two things grow with the data:
--
--   1. order_addons had no index on order_id (only a partial unique index on
--      (order_id, addon_id) WHERE addon_id IS NOT NULL, which a plain
--      order_id lookup can't use). Every order's add-ons — the app's cart
--      embeds, its RLS check, recompute_order_cart, the sheets — scanned the
--      whole table: 136,873 scans reading 224 million rows so far. Same gap on
--      a few other lookups by customer / order.
--   2. RLS policies called auth.uid() per row. Wrapped as (select auth.uid())
--      Postgres works it out once per query (Supabase's own advice).

CREATE INDEX IF NOT EXISTS idx_order_addons_order       ON public.order_addons (order_id);
CREATE INDEX IF NOT EXISTS idx_order_ingredients_order  ON public.order_ingredients (order_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user       ON public.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_user            ON public.payments (user_id);
CREATE INDEX IF NOT EXISTS idx_payments_subscription    ON public.payments (subscription_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_wallet         ON public.wallet_transactions (wallet_id);
CREATE INDEX IF NOT EXISTS idx_subscription_addons_addon ON public.subscription_addons (addon_id);

-- ── RLS: auth.uid() once per query ──────────────────────────────────────────
ALTER POLICY addresses_own ON public.addresses
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY dietary_profiles_own ON public.dietary_profiles
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY meal_ratings_select_own ON public.meal_ratings
  USING ((select auth.uid()) = user_id);
ALTER POLICY notifications_own ON public.notifications
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY order_addons_own ON public.order_addons
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_addons.order_id AND o.user_id = (select auth.uid())));
ALTER POLICY order_ingredients_select_own ON public.order_ingredients
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_ingredients.order_id AND o.user_id = (select auth.uid())));
ALTER POLICY orders_select_own ON public.orders
  USING ((select auth.uid()) = user_id);
ALTER POLICY orders_update_own ON public.orders
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY payments_select_own ON public.payments
  USING ((select auth.uid()) = user_id);
ALTER POLICY questionnaire_responses_own ON public.questionnaire_responses
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY subscription_addons_own ON public.subscription_addons
  USING (EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.id = subscription_addons.subscription_id AND s.user_id = (select auth.uid())));
ALTER POLICY subscription_schedule_own ON public.subscription_schedule
  USING (EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.id = subscription_schedule.subscription_id AND s.user_id = (select auth.uid())));
ALTER POLICY subscriptions_insert_own ON public.subscriptions
  WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY subscriptions_update_own ON public.subscriptions
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY subscriptions_select_own ON public.subscriptions
  USING ((select auth.uid()) = user_id);
ALTER POLICY users_insert_own ON public.users
  WITH CHECK ((select auth.uid()) = id);
ALTER POLICY users_update_own ON public.users
  USING ((select auth.uid()) = id) WITH CHECK ((select auth.uid()) = id);
ALTER POLICY users_select_own ON public.users
  USING ((select auth.uid()) = id);
ALTER POLICY wallet_transactions_select_own ON public.wallet_transactions
  USING ((select auth.uid()) = user_id);
ALTER POLICY wallets_insert_own ON public.wallets
  WITH CHECK ((select auth.uid()) = user_id AND balance = 0);
ALTER POLICY wallets_select_own ON public.wallets
  USING ((select auth.uid()) = user_id);

ANALYZE public.order_addons;
ANALYZE public.orders;
