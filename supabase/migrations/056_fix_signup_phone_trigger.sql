-- ============================================================
-- GreenFeast — Migration 056: fix new sign-ups (broken by 054)
-- ============================================================
-- New accounts are created by Supabase Auth (role supabase_auth_admin, whose
-- search_path is `auth`), through handle_new_auth_user() inserting into
-- public.users. 054's users_normalize_phone trigger called normalize_phone()
-- unqualified, which doesn't resolve under that search_path — so every new
-- sign-up (Google, Apple, email) failed with "Database error saving new
-- user" from 2026-10-14 ~15:45 IST until this fix. Existing users were fine.
-- Both functions now pin search_path and the call is schema-qualified.
-- ============================================================

CREATE OR REPLACE FUNCTION public.users_normalize_phone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.phone := public.normalize_phone(NEW.phone);
  RETURN NEW;
END; $$;

-- SECURITY DEFINER without a pinned search_path runs in whatever path the
-- caller has; pin it like every other definer function.
ALTER FUNCTION public.handle_new_auth_user() SET search_path = public;
