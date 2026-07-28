-- ============================================================
-- GreenFeast — Migration 030: Notification broadcasts
-- Run AFTER 029_admin_users.sql
--
-- Backs the admin dashboard's new Notifications tab: manual broadcasts
-- (promotional/custom), plus two automated triggers (delivery-status
-- updates from Operations, and a daily renewal-reminder check) — all of
-- them log here, one row per send. This is a separate table from the
-- existing `notifications` (the per-user in-app notification-centre log,
-- see 001_schema.sql) — that table still gets one row per recipient per
-- send (for the app's own notification history); this table is the admin's
-- audit trail of the *send itself* (who was targeted, how many channels
-- succeeded, etc).
-- ============================================================

CREATE TABLE public.notification_broadcasts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type                 TEXT NOT NULL,   -- 'promotional' | 'custom' | 'delivery_status' | 'renewal_reminder'
  title                TEXT NOT NULL,
  body                 TEXT NOT NULL,
  channels             TEXT[] NOT NULL DEFAULT ARRAY['push'],  -- subset of {'push','whatsapp'}
  audience             JSONB NOT NULL DEFAULT '{}',            -- describes the selection made, for display only
  recipient_count      INTEGER NOT NULL DEFAULT 0,
  push_sent_count      INTEGER NOT NULL DEFAULT 0,
  whatsapp_sent_count  INTEGER NOT NULL DEFAULT 0,
  results              JSONB NOT NULL DEFAULT '[]',            -- [{ user_id, name, push, whatsapp }] per-recipient outcome
  created_by           TEXT,            -- admin email for manual sends; NULL for automated ones
  created_at           TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.notification_broadcasts ENABLE ROW LEVEL SECURITY;
-- No policies → service-role (admin app) only, same pattern as every other
-- admin-only table (see 002_rls.sql's delivery_partners/otp_attempts/audit_log).

-- Dedup guard for the daily renewal-reminder check, so a subscriber sitting
-- in the "low deliveries remaining" window doesn't get pinged every day.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS last_renewal_reminder_sent_at TIMESTAMPTZ;
