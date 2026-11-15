-- ============================================================
-- GreenFeast — Migration 091: Jawahar Nagar closes at 9 PM
-- ============================================================
-- The Jawahar Nagar kitchen takes walk-ins 11 AM–9 PM (C-Scheme stays
-- 11 AM–11 PM). Everything reads pickup_locations.closes_at: the app's place
-- list and sheet, walk_in_quote's open_now, start_walk_in's refusal after
-- hours, and settle_pickups() (every 15 min), which lapses unused codes at
-- the place's own closing time, uncharged. lunch_until (4 PM) stays before it,
-- as the table's CHECK requires.

UPDATE public.pickup_locations
   SET closes_at = '21:00'
 WHERE id = 'jawahar-nagar';
