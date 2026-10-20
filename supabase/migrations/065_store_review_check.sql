-- ============================================================
-- GreenFeast — Migration 065: is this customer happy enough to be shown
-- Apple's / Google's own "rate this app" prompt?
-- ============================================================
-- The app asks this (read-only) before calling expo-store-review. True when:
--   · at least 8 meals delivered, and
--   · a meal delivered in the last 24 hours (skipped right after a renewal
--     payment, which is itself a happy moment), and
--   · no 1–2★ rating and no failed drop in the last 14 days.
-- "At most once per 120 days" is kept on the phone. Nothing is written.
-- ============================================================
CREATE OR REPLACE FUNCTION public.store_review_check(p_after_renewal boolean DEFAULT false)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;
  IF (SELECT count(*) FROM (
        SELECT DISTINCT delivery_date, meal_slot FROM public.orders
         WHERE user_id = v_uid AND status = 'delivered') m) < 8 THEN
    RETURN false;
  END IF;
  IF NOT p_after_renewal AND NOT EXISTS (
        SELECT 1 FROM public.orders
         WHERE user_id = v_uid AND status = 'delivered' AND delivered_at > now() - interval '24 hours') THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.meal_ratings
              WHERE user_id = v_uid AND stars <= 2 AND rated_at > now() - interval '14 days') THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.orders
              WHERE user_id = v_uid AND delivery_issue IS NOT NULL
                AND delivery_issue_at > now() - interval '14 days') THEN
    RETURN false;
  END IF;
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.store_review_check(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_review_check(boolean) TO authenticated;
