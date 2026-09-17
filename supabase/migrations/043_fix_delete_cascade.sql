-- ============================================================
-- Migration 043: Fix account self-deletion FK blocker
--
-- Migration 040 fixed payments.user_id to cascade on delete so the
-- delete-user-data edge function's auth.admin.deleteUser() call could
-- actually succeed. It missed two more tables with the same NO ACTION
-- default: orders.user_id and wallet_transactions.user_id. Any account
-- with a single order or wallet transaction — i.e. any account that has
-- ever actually used the app — hit a foreign key violation on self
-- delete, surfaced to the user as "Edge Function returned a non-2xx
-- status code."
--
-- The admin dashboard's own deleteUser() action never had this bug — it
-- manually deletes orders/wallet_transactions before touching the user
-- row (see greenfeast-admin/app/(admin)/users/actions.ts, wipeUserData).
-- This migration makes the in-app self-service path work the same way
-- the admin path already does, at the schema level instead of relying
-- on every caller remembering the right delete order.
--
-- Snapshotting into deleted_accounts still happens BEFORE this cascade
-- fires (delete-user-data reads everything first), so no data is lost —
-- it's just no longer blocking the actual delete.
-- ============================================================

ALTER TABLE public.orders
  DROP CONSTRAINT orders_user_id_fkey,
  ADD CONSTRAINT orders_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.wallet_transactions
  DROP CONSTRAINT wallet_transactions_user_id_fkey,
  ADD CONSTRAINT wallet_transactions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

NOTIFY pgrst, 'reload schema';
