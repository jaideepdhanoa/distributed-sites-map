-- Two sources that disagree about one site field or one P&L line.
-- Writes stay on POST /api/changes. Events stay append-only.
-- Adds data_conflict to the events check without dropping types other migrations added.
-- Safe before or after 015_tags.sql (tag), 017_site_spaces.sql (site_space),
-- and 018_pnl_basis.sql. 015 may land before or after this file.

CREATE TABLE IF NOT EXISTS data_conflicts (
  entity_id text PRIMARY KEY,
  site_id text NOT NULL,
  subject text NOT NULL,
  field_key text NOT NULL,
  period_key text NOT NULL DEFAULT '',
  source_a_value text NOT NULL,
  source_a_document text NOT NULL,
  source_a_page text NOT NULL,
  source_b_value text NOT NULL,
  source_b_document text NOT NULL,
  source_b_page text NOT NULL,
  value_in_use text NOT NULL,
  status text NOT NULL,
  resolution_note text NOT NULL DEFAULT '',
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_at_iso text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_at_iso text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT data_conflicts_subject_check CHECK (subject IN ('field', 'pnl_line')),
  CONSTRAINT data_conflicts_status_check CHECK (status IN ('open', 'asked_broker', 'resolved')),
  CONSTRAINT data_conflicts_resolution_check CHECK (
    (status = 'resolved' AND length(btrim(resolution_note)) > 0)
    OR (status <> 'resolved' AND resolution_note = '')
  ),
  CONSTRAINT data_conflicts_value_check CHECK (value_in_use IN (source_a_value, source_b_value)),
  CONSTRAINT data_conflicts_created_iso_check CHECK (created_at_iso ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$'),
  CONSTRAINT data_conflicts_updated_iso_check CHECK (updated_at_iso ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$')
);

CREATE UNIQUE INDEX IF NOT EXISTS data_conflicts_open_key
  ON data_conflicts (site_id, subject, field_key, period_key)
  WHERE status <> 'resolved';

DO $$
DECLARE
  def text;
  names text[] := ARRAY['stage', 'activity', 'comms', 'site', 'pnl_line', 'site_space', 'tag', 'data_conflict'];
  token text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
  FROM pg_constraint
  WHERE conname = 'events_entity_type_check'
    AND conrelid = 'events'::regclass;
  IF def IS NULL THEN
    RAISE EXCEPTION 'events_entity_type_check is missing';
  END IF;
  FOR token IN
    SELECT (regexp_matches(def, '''([a-z_]+)''', 'g'))[1]
  LOOP
    IF NOT token = ANY(names) THEN
      names := array_append(names, token);
    END IF;
  END LOOP;
  EXECUTE 'ALTER TABLE events DROP CONSTRAINT events_entity_type_check';
  EXECUTE format(
    'ALTER TABLE events ADD CONSTRAINT events_entity_type_check CHECK (entity_type IN (%s))',
    (SELECT string_agg(quote_literal(name), ', ') FROM unnest(names) AS name)
  );
END $$;
