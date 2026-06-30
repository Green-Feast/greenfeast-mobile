-- ============================================================
-- GreenFeast — Migration 021: Delete all test users + their data
-- Run once in the Supabase SQL Editor before going live.
--
-- Deletion order matters: tables with user_id FKs that have no
-- ON DELETE CASCADE must be cleared BEFORE auth.users is deleted,
-- otherwise Postgres raises a FK violation.
-- ============================================================

-- 1. wallet_transactions — user_id FK to public.users with no CASCADE
DELETE FROM public.wallet_transactions;

-- 2. payments — user_id FK to public.users with no CASCADE
DELETE FROM public.payments;

-- 3. orders — user_id FK to public.users with no CASCADE
--    Deleting orders also cascades: order_addons, order_ingredients
DELETE FROM public.orders;

-- 4. Housekeeping — no user FKs, just stale dev data
DELETE FROM public.otp_attempts;
DELETE FROM public.audit_log;

-- 5. Delete all auth users.
--    Cascades to public.users, which cascades to:
--      dietary_profiles, addresses, subscriptions (→ subscription_schedule,
--      subscription_addons), wallets, questionnaire_responses, notifications
DELETE FROM auth.users;

NOTIFY pgrst, 'reload schema';
