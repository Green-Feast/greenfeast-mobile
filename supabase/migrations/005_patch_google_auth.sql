-- ============================================================
-- GreenFeast — Migration 005: Switch to Google/Apple auth
-- Run in Supabase SQL Editor after 004_patch_delivery.sql
-- ============================================================

-- 1. Phone is collected + verified during onboarding, not at sign-in.
--    Google/Apple auth creates the user before we have a phone, so allow NULL.
ALTER TABLE public.users ALTER COLUMN phone DROP NOT NULL;


-- 2. Auto-create a public.users row the moment someone signs in via Google/Apple.
--    Without this, the app would need to manually INSERT after OAuth — fragile.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
