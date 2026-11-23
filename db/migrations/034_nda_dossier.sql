-- Additive NDA dossier fields. The register snapshot stays the baseline.
-- The app does not apply this file to production.

ALTER TABLE nda_state ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT '';
ALTER TABLE nda_state ADD COLUMN IF NOT EXISTS court text NOT NULL DEFAULT '';
ALTER TABLE nda_state ADD COLUMN IF NOT EXISTS court_detail text NOT NULL DEFAULT '';
ALTER TABLE nda_state ADD COLUMN IF NOT EXISTS court_since timestamptz;
ALTER TABLE nda_state ADD COLUMN IF NOT EXISTS next_step_due date;
ALTER TABLE nda_state ADD COLUMN IF NOT EXISTS document_url text NOT NULL DEFAULT '';
ALTER TABLE nda_state ADD COLUMN IF NOT EXISTS document_kind text NOT NULL DEFAULT '';
ALTER TABLE nda_state ADD COLUMN IF NOT EXISTS contact_name text NOT NULL DEFAULT '';
ALTER TABLE nda_state ADD COLUMN IF NOT EXISTS contact_email text NOT NULL DEFAULT '';
ALTER TABLE nda_state ADD COLUMN IF NOT EXISTS contact_phone text NOT NULL DEFAULT '';
ALTER TABLE nda_state ADD COLUMN IF NOT EXISTS gmail_thread_ids text[] NOT NULL DEFAULT '{}';
ALTER TABLE nda_state ADD COLUMN IF NOT EXISTS covered_refs text[] NOT NULL DEFAULT '{}';
ALTER TABLE nda_state ADD COLUMN IF NOT EXISTS source_ref text NOT NULL DEFAULT '';
