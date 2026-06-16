-- ============================================================
-- GreenFeast — Migration 004: Delivery Partners + Batch Restructure
-- Run in Supabase SQL Editor after 003_seed.sql
-- Safe to run: batches table has no data yet
-- ============================================================

-- 1. Create delivery_partners (must exist before batches references it)
CREATE TABLE public.delivery_partners (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  phone              TEXT NOT NULL,
  alternate_phone    TEXT,
  aadhaar_number     TEXT,
  aadhaar_doc_url    TEXT,
  pan_number         TEXT,
  pan_doc_url        TEXT,
  dl_number          TEXT,
  dl_doc_url         TEXT,
  vehicle_rc_number  TEXT,
  vehicle_rc_doc_url TEXT,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  notes              TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at         TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TRIGGER delivery_partners_updated_at
  BEFORE UPDATE ON public.delivery_partners
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.delivery_partners ENABLE ROW LEVEL SECURITY;
-- No RLS policies → service role only (admin app + Edge Functions)


-- 2. Drop old batches table (no data, safe to drop and recreate)
DROP TABLE public.batches CASCADE;
-- CASCADE also drops the public_read_batches RLS policy and any FKs pointing to it.
-- subscriptions.batch_id FK is dropped here; recreated below.


-- 3. Recreate batches with new structure
CREATE TABLE public.batches (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT NOT NULL,
  area                 TEXT,
  time_window          TEXT NOT NULL CHECK (time_window IN ('morning', 'noon', 'evening')),
  primary_partner_id   UUID REFERENCES public.delivery_partners(id) ON DELETE SET NULL,
  secondary_partner_id UUID REFERENCES public.delivery_partners(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at           TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TRIGGER batches_updated_at
  BEFORE UPDATE ON public.batches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_batches"
  ON public.batches FOR SELECT USING (true);


-- 4. Restore subscriptions.batch_id FK (was dropped by CASCADE above)
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES public.batches(id) ON DELETE SET NULL;

-- 5. Restore orders.batch_id FK (also dropped by CASCADE)
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES public.batches(id) ON DELETE SET NULL;
