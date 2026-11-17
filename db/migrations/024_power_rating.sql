-- Derived power rating. A person does not type this grade.
-- 022 and 023 belong to other changes. This file does not depend on them.
-- Production applies this from the Production migrations workflow, not from CI.

ALTER TABLE sites ADD COLUMN IF NOT EXISTS power_rating text NOT NULL DEFAULT '';
ALTER TABLE sites ADD COLUMN IF NOT EXISTS power_rating_reason text NOT NULL DEFAULT '';
ALTER TABLE sites ADD COLUMN IF NOT EXISTS power_rating_inputs jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE sites DROP CONSTRAINT IF EXISTS sites_power_rating_check;
ALTER TABLE sites ADD CONSTRAINT sites_power_rating_check
  CHECK (power_rating IN ('', 'Strong', 'OK', 'Weak', 'Unknown'));
