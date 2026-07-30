-- ============================================================
-- GreenFeast — Migration 031: Server-side per-slot delivery cutoff
-- Run AFTER 030_notification_broadcasts.sql
--
-- Lunch locks 08:00 IST, dinner locks 13:00 IST, both on the delivery date
-- itself. This mirrors src/lib/ist.ts's isSlotLocked() — that client copy is
-- for UI only; before this migration there was ZERO server-side enforcement
-- of any cutoff (every edit edge function only rejected strictly-past dates,
-- in UTC). is_slot_locked() is the one source of truth every edge function
-- should call instead of reimplementing this in TypeScript.
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_slot_locked(p_date date, p_slot text)
RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_today_ist date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_now_ist   time := (now() AT TIME ZONE 'Asia/Kolkata')::time;
  v_cutoff    time;
BEGIN
  IF p_date < v_today_ist THEN RETURN true; END IF;
  IF p_date > v_today_ist THEN RETURN false; END IF;

  v_cutoff := CASE p_slot
    WHEN 'lunch'  THEN TIME '08:00'
    WHEN 'dinner' THEN TIME '13:00'
    ELSE TIME '00:00'  -- unknown slot: treat as locked from midnight, same-day
  END;
  RETURN v_now_ist >= v_cutoff;
END; $$;

GRANT EXECUTE ON FUNCTION public.is_slot_locked(date, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
