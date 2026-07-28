-- ============================================================
-- GreenFeast — Migration 029: Admin allow-list
-- Run AFTER 028_meal_details_from_menu_csv.sql
--
-- Gates who can sign into the admin dashboard (greenfeast-admin). Both the
-- consumer app and the admin app share this Supabase project, so the admin
-- login reuses Supabase Auth (auth.users) rather than a separate credential
-- store — a "log into admin" is just a normal Supabase Auth sign-in for a
-- user whose id is also listed here. Anyone can attempt to sign in with any
-- valid consumer credentials; this table is what actually decides whether
-- that session is allowed to reach the dashboard.
--
-- No RLS policies are added on purpose: only the admin app's service-role
-- client ever reads/writes this table (matches every other admin-only table
-- in this schema — see 002_rls.sql's delivery_partners/otp_attempts/
-- audit_log comments for the same pattern).
-- ============================================================

CREATE TABLE public.admin_users (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- ── To add yourself as an admin ──────────────────────────────────────────
-- 1. Supabase Dashboard → Authentication → Users → Add user (email +
--    password, "Auto Confirm User" checked). Copy the new user's UUID.
-- 2. Run, with your own values:
--      INSERT INTO public.admin_users (user_id, email)
--      VALUES ('<uuid-from-step-1>', 'you@example.com');
