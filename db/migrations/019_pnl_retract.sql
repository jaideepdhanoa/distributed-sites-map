-- One decimal place on a captured amount, and a soft retract for a P&L line.
-- Existing amount text still matches. A retracted row stays in the table.
-- The events row is the change log. Nothing here is run against production
-- by this file; production migrations stay on the manual workflow.

DO $$
DECLARE
  cons_name text;
BEGIN
  FOR cons_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'pnl_lines'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%amount_text%'
      AND pg_get_constraintdef(con.oid) ILIKE '%~%'
  LOOP
    EXECUTE format('ALTER TABLE pnl_lines DROP CONSTRAINT %I', cons_name);
  END LOOP;
END $$;

ALTER TABLE pnl_lines
  ADD CONSTRAINT pnl_lines_amount_text_check
  CHECK (
    amount_text IS NULL
    OR amount_text ~ '^-?(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$'
  );

ALTER TABLE pnl_lines
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_at_iso text,
  ADD COLUMN deleted_by text,
  ADD COLUMN delete_reason text;

ALTER TABLE pnl_lines
  ADD CONSTRAINT pnl_lines_retract_check CHECK (
    (
      deleted_at IS NULL
      AND deleted_at_iso IS NULL
      AND deleted_by IS NULL
      AND delete_reason IS NULL
    )
    OR
    (
      deleted_at IS NOT NULL
      AND deleted_at_iso IS NOT NULL
      AND deleted_at_iso ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,3})?)?(Z|[+-][0-9]{2}:[0-9]{2})$'
      AND deleted_by IS NOT NULL
      AND length(btrim(deleted_by)) > 0
      AND delete_reason IS NOT NULL
      AND length(btrim(delete_reason)) > 0
    )
  );

DROP INDEX IF EXISTS pnl_lines_period_line_status_key;
CREATE UNIQUE INDEX pnl_lines_period_line_status_key
  ON pnl_lines (period_id, line_code, status)
  WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS pnl_lines_period_missing_key;
CREATE UNIQUE INDEX pnl_lines_period_missing_key
  ON pnl_lines (period_id)
  WHERE status = 'missing' AND deleted_at IS NULL;
