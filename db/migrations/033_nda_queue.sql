-- NDA queue writes. The register snapshot stays the baseline.
-- nda_state holds the latest status, waiting-on, owner, and next step.
-- nda_history keeps each status change and the note that came with it.
-- Notes may use target_kind nda so one agreement has one thread.
-- The app does not apply this file to production.

CREATE TABLE IF NOT EXISTS nda_state (
  nda_id text PRIMARY KEY,
  status text NOT NULL DEFAULT '',
  waiting_on text NOT NULL DEFAULT '',
  owner text NOT NULL DEFAULT '',
  next_step text NOT NULL DEFAULT '',
  last_action text NOT NULL DEFAULT '',
  last_action_date text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 0,
  updated_by text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nda_history (
  id text PRIMARY KEY,
  nda_id text NOT NULL,
  status text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  actor text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nda_history_nda_idx ON nda_history (nda_id, at);

ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_target_kind_check;
ALTER TABLE notes ADD CONSTRAINT notes_target_kind_check
  CHECK (target_kind IN ('site', 'deal', 'suggestion', 'site_space', 'nda'));

DO $$
DECLARE
  def text;
  names text[] := ARRAY['stage', 'activity', 'comms', 'site', 'pnl_line', 'site_space', 'tag', 'data_conflict', 'comment', 'nda'];
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
