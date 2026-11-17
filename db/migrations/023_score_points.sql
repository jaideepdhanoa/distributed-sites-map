-- Workbook formula columns next to Score (of 100) and Location points.
-- Copied on sync by header name. Never written back, and not accepted on POST /api/changes.
-- The app does not recompute these numbers.

ALTER TABLE sites ADD COLUMN IF NOT EXISTS economics_points text NOT NULL DEFAULT '';
ALTER TABLE sites ADD COLUMN IF NOT EXISTS land_points text NOT NULL DEFAULT '';
ALTER TABLE sites ADD COLUMN IF NOT EXISTS power_points text NOT NULL DEFAULT '';
ALTER TABLE sites ADD COLUMN IF NOT EXISTS deal_points text NOT NULL DEFAULT '';
