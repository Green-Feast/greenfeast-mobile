-- Migration 026: Record Terms & Conditions / Privacy Policy acceptance.
--
-- The app now requires a new user to check "I agree to the Terms &
-- Conditions and Privacy Policy" before continuing past the name screen
-- (the universal new-account gate reached by every signup path — Google,
-- Apple, and email). This column records when that happened, and which
-- version of the legal text they agreed to (see LEGAL_LAST_UPDATED in
-- src/constants/legal.ts), so consent is auditable rather than only a
-- client-side gate on the signup button.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terms_version TEXT;

NOTIFY pgrst, 'reload schema';
