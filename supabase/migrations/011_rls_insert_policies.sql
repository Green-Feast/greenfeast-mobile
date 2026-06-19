-- ============================================================
-- GreenFeast — Migration 011: Missing RLS INSERT policies
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor)
--
-- Fixes "new row violates row-level security policy" during onboarding:
-- subscriptions and wallets had no client INSERT policy, so the app could
-- never create a subscription. Also enables RLS on questionnaire_responses
-- (added in migration 006 without any policy).
-- ============================================================

-- ── subscriptions: a user may create their own subscription ─────────────────────
DROP POLICY IF EXISTS "subscriptions_insert_own" ON public.subscriptions;
CREATE POLICY "subscriptions_insert_own"
  ON public.subscriptions FOR INSERT
  WITH CHECK (auth.uid() = user_id);


-- ── wallets: a user may create their own zero-balance wallet ────────────────────
-- Balance changes still happen server-side (service role) only — never allow the
-- client to set an arbitrary starting balance.
DROP POLICY IF EXISTS "wallets_insert_own" ON public.wallets;
CREATE POLICY "wallets_insert_own"
  ON public.wallets FOR INSERT
  WITH CHECK (auth.uid() = user_id AND balance = 0);


-- ── questionnaire_responses: own-row access (RLS was never enabled) ──────────────
ALTER TABLE public.questionnaire_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "questionnaire_responses_own" ON public.questionnaire_responses;
CREATE POLICY "questionnaire_responses_own"
  ON public.questionnaire_responses FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
