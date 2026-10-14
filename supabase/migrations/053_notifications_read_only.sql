-- ============================================================
-- GreenFeast — Migration 053: customers can only mark notifications read
-- ============================================================
-- The bell in the app now shows every message from the notifications table
-- (not only this device's update notes) and marks them read. That's all a
-- customer should be able to do: rows are written by the server
-- (notify_user / notify_event, admin sends), so INSERT/DELETE and editing
-- the text are no longer granted to customers.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.notifications FROM anon, authenticated;
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (read) ON public.notifications TO authenticated;
