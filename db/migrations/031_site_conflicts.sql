-- Site-field conflicts sit beside P&L conflicts.
-- subject names the site field when two sources disagree about identity or spare area.

ALTER TABLE data_conflicts DROP CONSTRAINT IF EXISTS data_conflicts_subject_check;
ALTER TABLE data_conflicts
  ADD CONSTRAINT data_conflicts_subject_check
  CHECK (subject IN ('field', 'pnl_line', 'address', 'apn', 'lat', 'lng', 'open_land_sqft'));
