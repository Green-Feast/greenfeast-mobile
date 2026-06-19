-- ============================================================
-- GreenFeast — Migration 014: Restore batch_id foreign keys
-- Run in the Supabase SQL Editor.
--
-- WHY: Migration 004 dropped the batches table with CASCADE (which dropped the
-- subscriptions.batch_id and orders.batch_id foreign keys), then tried to
-- restore them with `ADD COLUMN IF NOT EXISTS batch_id ... REFERENCES batches`.
-- But those columns already existed, so Postgres skipped the entire statement —
-- including the REFERENCES clause. Result: the columns exist with NO foreign
-- key to the new batches table, so PostgREST reports
--   PGRST200: Could not find a relationship between 'subscriptions' and 'batches'
-- which breaks the admin Subscribers and Operations pages (they embed
-- subscriptions -> batches(name)).
--
-- This adds the missing FKs explicitly. Idempotent.
-- ============================================================

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_batch_id_fkey;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_batch_id_fkey
  FOREIGN KEY (batch_id) REFERENCES public.batches(id) ON DELETE SET NULL;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_batch_id_fkey;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_batch_id_fkey
  FOREIGN KEY (batch_id) REFERENCES public.batches(id) ON DELETE SET NULL;

-- Ask PostgREST to reload its schema cache so the new relationships are picked up.
NOTIFY pgrst, 'reload schema';
