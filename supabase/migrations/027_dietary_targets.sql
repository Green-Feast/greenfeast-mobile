-- ============================================================
-- GreenFeast — Migration 027: Daily protein + fibre targets
-- ============================================================
-- health.tsx (SF5) already collects a protein target but never persisted it;
-- fibre target is a new field added alongside it. Both optional (nullable).

ALTER TABLE public.dietary_profiles
  ADD COLUMN IF NOT EXISTS protein_target INTEGER,
  ADD COLUMN IF NOT EXISTS fibre_target   INTEGER;
