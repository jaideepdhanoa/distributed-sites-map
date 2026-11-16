-- Captured profit-and-loss periods and line items, keyed to a site id.
-- The app does not apply this file to production. Jaideep runs the
-- Production migrations workflow. A signed-in read shows an empty state
-- until the tables exist. Nothing here is written back to the workbook.

DO $$
DECLARE
  cons_name text;
BEGIN
  SELECT con.conname INTO cons_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'events'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%entity_type%';
  IF cons_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE events DROP CONSTRAINT %I', cons_name);
  END IF;
END $$;

ALTER TABLE events ADD CONSTRAINT events_entity_type_check
  CHECK (entity_type IN ('stage', 'activity', 'comms', 'site', 'pnl_line'));

CREATE TABLE pnl_periods (
  entity_id text PRIMARY KEY,
  site_id text NOT NULL,
  grain text NOT NULL CHECK (grain IN ('annual', 'monthly')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  year integer NOT NULL CHECK (year BETWEEN 1990 AND 2100),
  month integer CHECK (month BETWEEN 1 AND 12),
  through_month integer CHECK (through_month BETWEEN 1 AND 12),
  business_type text NOT NULL CHECK (business_type IN ('car_wash', 'auto_service')),
  version integer NOT NULL CHECK (version >= 1),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by text NOT NULL,
  CHECK (
    (grain = 'annual' AND month IS NULL AND period_start = make_date(year, 1, 1))
    OR
    (grain = 'monthly' AND month IS NOT NULL AND through_month IS NULL AND period_start = make_date(year, month, 1))
  ),
  UNIQUE (site_id, grain, period_start)
);

CREATE INDEX pnl_periods_site_idx ON pnl_periods (site_id, year);

CREATE TABLE pnl_lines (
  entity_id text PRIMARY KEY,
  period_id text NOT NULL REFERENCES pnl_periods (entity_id),
  site_id text NOT NULL,
  line_code text NOT NULL CHECK (line_code IN (
    'revenue_wash', 'revenue_membership', 'revenue_retail', 'revenue_service', 'revenue_parts', 'revenue_other', 'revenue',
    'cogs', 'labor', 'utilities', 'chemicals', 'occupancy', 'repairs', 'marketing', 'ga', 'other',
    'ebitda', 'noi',
    'addback_owner_pay', 'addback_personal', 'addback_one_time', 'addback_other'
  )),
  amount numeric(14, 2) NOT NULL,
  amount_text text NOT NULL CHECK (amount_text ~ '^-?(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{2})?$'),
  status text NOT NULL CHECK (status IN ('reported', 'estimated')),
  source_document text NOT NULL CHECK (length(btrim(source_document)) > 0),
  source_page text NOT NULL CHECK (length(btrim(source_page)) > 0),
  source_href text NOT NULL DEFAULT '',
  captured_at timestamptz NOT NULL,
  captured_at_iso text NOT NULL CHECK (captured_at_iso ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,3})?)?(Z|[+-][0-9]{2}:[0-9]{2})$'),
  version integer NOT NULL CHECK (version >= 1),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by text NOT NULL,
  UNIQUE (period_id, line_code)
);

CREATE INDEX pnl_lines_site_idx ON pnl_lines (site_id);
