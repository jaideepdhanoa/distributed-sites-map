-- Comment threads on a P&L cell, a P&L line, or a marked lot.
-- The row is a note, so the site discussion and the anchor share one copy.
-- Writes stay on POST /api/changes. The app does not apply this file to production.

ALTER TABLE notes ADD COLUMN IF NOT EXISTS entity_id text;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS version integer;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS anchor_type text;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS anchor_line text NOT NULL DEFAULT '';
ALTER TABLE notes ADD COLUMN IF NOT EXISTS anchor_period text NOT NULL DEFAULT '';
ALTER TABLE notes ADD COLUMN IF NOT EXISTS anchor_space_id text NOT NULL DEFAULT '';
ALTER TABLE notes ADD COLUMN IF NOT EXISTS anchor_label text NOT NULL DEFAULT '';
ALTER TABLE notes ADD COLUMN IF NOT EXISTS tag text NOT NULL DEFAULT '';
ALTER TABLE notes ADD COLUMN IF NOT EXISTS created_at_iso text NOT NULL DEFAULT '';
ALTER TABLE notes ADD COLUMN IF NOT EXISTS updated_at_iso text NOT NULL DEFAULT '';

ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_anchor_type_check;
ALTER TABLE notes ADD CONSTRAINT notes_anchor_type_check CHECK (
  anchor_type IS NULL
  OR (
    anchor_type = 'pnl_cell'
    AND anchor_line <> ''
    AND anchor_period <> ''
    AND anchor_space_id = ''
  )
  OR (
    anchor_type = 'pnl_line'
    AND anchor_line <> ''
    AND anchor_period = ''
    AND anchor_space_id = ''
  )
  OR (
    anchor_type = 'space'
    AND anchor_space_id <> ''
    AND anchor_line = ''
    AND anchor_period = ''
  )
);

ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_tag_check;
ALTER TABLE notes ADD CONSTRAINT notes_tag_check CHECK (
  tag = '' OR tag IN ('investigate', 'ask_broker', 'normalize', 'explained', 'verified')
);

ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_anchor_tag_check;
ALTER TABLE notes ADD CONSTRAINT notes_anchor_tag_check CHECK (
  anchor_type IS NULL OR parent_id IS NOT NULL OR tag <> ''
);

ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_anchor_version_check;
ALTER TABLE notes ADD CONSTRAINT notes_anchor_version_check CHECK (
  anchor_type IS NULL OR (version IS NOT NULL AND version >= 1)
);

ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_created_iso_check;
ALTER TABLE notes ADD CONSTRAINT notes_created_iso_check CHECK (
  created_at_iso = ''
  OR created_at_iso ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$'
);

ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_updated_iso_check;
ALTER TABLE notes ADD CONSTRAINT notes_updated_iso_check CHECK (
  updated_at_iso = ''
  OR updated_at_iso ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$'
);

ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_anchor_iso_check;
ALTER TABLE notes ADD CONSTRAINT notes_anchor_iso_check CHECK (
  anchor_type IS NULL
  OR created_at_iso ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$'
);

CREATE UNIQUE INDEX IF NOT EXISTS notes_entity_id_idx ON notes (entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS notes_anchor_idx ON notes (target_id, anchor_type) WHERE deleted_at IS NULL AND anchor_type IS NOT NULL;

DO $$
DECLARE
  def text;
  names text[] := ARRAY['stage', 'activity', 'comms', 'site', 'pnl_line', 'site_space', 'tag', 'data_conflict', 'comment'];
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
