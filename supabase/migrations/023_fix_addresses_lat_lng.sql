-- Migration 023: Ensure addresses.lat / addresses.lng exist.
--
-- The app writes lat/lng (the map pin coordinates) to addresses, but earlier
-- migration history added latitude/longitude instead, so the lat/lng columns
-- were missing on the live DB ("Could not find the 'lat' column of 'addresses'
-- in the schema cache"). This adds them idempotently and reloads the cache.

ALTER TABLE public.addresses
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision;

NOTIFY pgrst, 'reload schema';
