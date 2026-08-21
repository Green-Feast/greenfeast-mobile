-- ============================================================
-- Migration 040: Account deletion archive
--
-- Real account deletion (not the dev "reset all data" path) must delete the
-- auth.users row so the same Google/Apple identity can sign up fresh
-- afterward — Supabase only mints a new identity if the old auth.users row
-- is actually gone. But public.users.id IS auth.users.id (PK+FK+CASCADE), so
-- deleting the auth user cascades away the live profile, subscriptions,
-- orders, addresses, and wallet. deleted_accounts captures a snapshot of all
-- of that (for admin visibility) before the cascade wipes it.
-- ============================================================

CREATE TABLE public.deleted_accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_user_id  UUID NOT NULL,
  name              TEXT,
  phone             TEXT,
  email             TEXT,
  snapshot          JSONB NOT NULL,
  deleted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_deleted_accounts_deleted_at ON public.deleted_accounts (deleted_at DESC);

ALTER TABLE public.deleted_accounts ENABLE ROW LEVEL SECURITY;
-- Admin-only — same posture as admin_users: no anon/authenticated policy at
-- all, only service_role (which bypasses RLS) can read or write this table.
GRANT SELECT, INSERT ON public.deleted_accounts TO service_role;

-- payments.user_id has no ON DELETE action today, so it silently blocks any
-- cascade delete of a user who has ever paid for anything — i.e. every real
-- subscriber. The amounts are captured in the snapshot above, so it's safe
-- to let the live rows cascade away too.
ALTER TABLE public.payments
  DROP CONSTRAINT payments_user_id_fkey,
  ADD CONSTRAINT payments_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

NOTIFY pgrst, 'reload schema';
