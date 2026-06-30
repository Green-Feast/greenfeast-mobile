-- Migration 019: Add 'calendar' delivery mode + lat/lng on addresses

-- 1. Extend delivery_mode CHECK to allow 'calendar'
ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_delivery_mode_check;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_delivery_mode_check
    CHECK (delivery_mode IN ('opt-in', 'opt-out', 'calendar'));

-- 2. Add geodata columns to addresses (nullable; populated by the app when
--    the user selects a location via the map picker).
ALTER TABLE addresses
  ADD COLUMN IF NOT EXISTS lat  double precision,
  ADD COLUMN IF NOT EXISTS lng  double precision;

NOTIFY pgrst, 'reload schema';
