-- ============================================================
-- GreenFeast — Migration 047: let edge functions send notifications
-- ============================================================
-- 045 revoked notify_user from PUBLIC, which also left service_role (the
-- edge functions' role) without EXECUTE. cashfree-webhook calls it for
-- refund outcomes.
GRANT EXECUTE ON FUNCTION public.notify_user(uuid, text, text, text) TO service_role;
