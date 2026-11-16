-- R-102. Additive period identity and line basis.
-- Existing rows stay valid: stated is still stored as reported, a calendar
-- year still starts on January 1, and a partial year still uses through_month.
-- Nothing here is written back to the workbook.

ALTER TABLE pnl_periods
  ADD COLUMN start_month integer,
  ADD COLUMN missing boolean NOT NULL DEFAULT false;

ALTER TABLE pnl_periods
  ADD CONSTRAINT pnl_periods_start_month_check
  CHECK (start_month IS NULL OR start_month BETWEEN 1 AND 12);

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
      AND rel.relname = 'pnl_periods'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%period_start%'
  LOOP
    EXECUTE format('ALTER TABLE pnl_periods DROP CONSTRAINT %I', cons_name);
  END LOOP;

  SELECT con.conname INTO cons_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'pnl_periods'
    AND con.contype = 'u'
    AND pg_get_constraintdef(con.oid) ILIKE '%period_start%';
  IF cons_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE pnl_periods DROP CONSTRAINT %I', cons_name);
  END IF;
END $$;

ALTER TABLE pnl_periods
  ADD CONSTRAINT pnl_periods_coverage_check CHECK (
    period_end >= period_start
    AND period_end <= period_start + 366
    AND (
      (
        grain = 'annual'
        AND month IS NULL
        AND period_start = make_date(year, COALESCE(start_month, 1), 1)
      )
      OR
      (
        grain = 'monthly'
        AND month BETWEEN 1 AND 12
        AND through_month IS NULL
        AND start_month IS NULL
        AND period_start = make_date(year, month, 1)
        AND period_end < period_start + 32
      )
    )
  );

ALTER TABLE pnl_periods
  ADD CONSTRAINT pnl_periods_identity_key
  UNIQUE (site_id, grain, period_start, period_end);

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
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
      AND pg_get_constraintdef(con.oid) NOT ILIKE '%line_code%'
  LOOP
    EXECUTE format('ALTER TABLE pnl_lines DROP CONSTRAINT %I', cons_name);
  END LOOP;

  SELECT con.conname INTO cons_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'pnl_lines'
    AND con.contype = 'u'
    AND pg_get_constraintdef(con.oid) ILIKE '%line_code%';
  IF cons_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE pnl_lines DROP CONSTRAINT %I', cons_name);
  END IF;
END $$;

ALTER TABLE pnl_lines ALTER COLUMN amount DROP NOT NULL;
ALTER TABLE pnl_lines ALTER COLUMN amount_text DROP NOT NULL;
ALTER TABLE pnl_lines ALTER COLUMN line_code DROP NOT NULL;

ALTER TABLE pnl_lines
  ADD CONSTRAINT pnl_lines_status_check
  CHECK (status IN ('reported', 'estimated', 'normalized', 'missing'));

ALTER TABLE pnl_lines
  ADD CONSTRAINT pnl_lines_amount_status_check CHECK (
    (
      status = 'missing'
      AND amount IS NULL
      AND amount_text IS NULL
      AND line_code IS NULL
    )
    OR
    (
      status IN ('reported', 'estimated', 'normalized')
      AND amount IS NOT NULL
      AND amount_text IS NOT NULL
      AND line_code IS NOT NULL
    )
  );

CREATE UNIQUE INDEX pnl_lines_period_line_status_key
  ON pnl_lines (period_id, line_code, status);

CREATE UNIQUE INDEX pnl_lines_period_missing_key
  ON pnl_lines (period_id)
  WHERE status = 'missing';
