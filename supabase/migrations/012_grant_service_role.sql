-- ============================================================
-- GreenFeast — Migration 012: Restore service_role privileges
-- Run in the Supabase SQL Editor (as the postgres role).
--
-- WHY: The admin app (greenfeast-admin) and all Edge Functions use the
-- service_role key. A diagnostic against the live project showed service_role
-- has NO table privileges on the public schema — every PostgREST table read
-- returns 42501 "permission denied for table ...". This silently breaks every
-- table-backed admin page (Dashboard, Subscribers, Operations, Batches,
-- Delivery Partners) and would block all of the wallet/kitchen work that
-- relies on service_role. The mobile app keeps working only because it uses
-- the anon key + RLS, and the Users tab works only because it uses the GoTrue
-- admin API (not PostgREST).
--
-- This restores the standard Supabase grants for service_role and sets default
-- privileges so future migrations don't reintroduce the gap.
-- Safe to run multiple times (idempotent).
-- ============================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- service_role must bypass RLS *and* hold table privileges
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL ROUTINES  IN SCHEMA public TO service_role;

-- Ensure any objects created later are auto-granted to service_role
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES  TO service_role;

-- (anon / authenticated already work via existing RLS policies + grants; the
--  USAGE grant above is a harmless safety net.)
