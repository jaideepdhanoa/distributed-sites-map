-- Marked areas on a site aerial. The app does not apply this file to production.
-- Jaideep runs the Production migrations workflow. Until then a signed-in
-- read shows no marked spaces. Nothing here is written back to the workbook.
--
-- History for a later review UI is the events row written with every change.
-- status can become verified once a source is stored (R-088). est_slots is
-- the number a card or grid can sum. Agents read this table; they do not
-- write it in this phase.

DO $$
DECLARE
  cons_name text;
  def text;
  list text;
BEGIN
  SELECT con.conname, pg_get_constraintdef(con.oid)
    INTO cons_name, def
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

  -- Keep entity types added by earlier migrations, and add site_space.
  SELECT string_agg(quote_literal(t), ', ' ORDER BY t)
    INTO list
  FROM (
    SELECT DISTINCT t
    FROM (
      SELECT unnest(ARRAY['stage', 'activity', 'comms', 'site', 'pnl_line', 'site_space']) AS t
      UNION
      SELECT m[1]
      FROM regexp_matches(COALESCE(def, ''), '''([a-z0-9_]+)''', 'g') AS m
      WHERE m[1] NOT IN ('text', 'public', 'integer', 'numeric')
    ) found
  ) uniq;

  EXECUTE 'ALTER TABLE events ADD CONSTRAINT events_entity_type_check CHECK (entity_type IN (' || list || '))';
END $$;

ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_target_kind_check;
ALTER TABLE notes ADD CONSTRAINT notes_target_kind_check
  CHECK (target_kind IN ('site', 'deal', 'suggestion', 'site_space'));

CREATE TABLE site_spaces (
  id text PRIMARY KEY,
  site_id text NOT NULL,
  polygon jsonb NOT NULL,
  rotation_deg double precision NOT NULL,
  center_lng double precision NOT NULL,
  center_lat double precision NOT NULL,
  length_ft double precision NOT NULL CHECK (length_ft > 0 AND length_ft <= 2000),
  width_ft double precision NOT NULL CHECK (width_ft > 0 AND width_ft <= 2000),
  area_sqft double precision NOT NULL CHECK (area_sqft >= 0),
  type text NOT NULL CHECK (type IN ('excess_parking', 'vacuum_row', 'unused_pad')),
  layout text NOT NULL CHECK (layout IN ('stalls_90', 'stalls_60', 'stalls_45', 'pull_through')),
  est_slots integer NOT NULL CHECK (est_slots >= 0),
  status text NOT NULL DEFAULT 'estimated' CHECK (status IN ('estimated', 'verified')),
  verified_source text,
  verified_at timestamptz,
  verified_by text,
  author text NOT NULL CHECK (length(btrim(author)) > 0),
  updated_by text NOT NULL CHECK (length(btrim(updated_by)) > 0),
  version integer NOT NULL CHECK (version >= 1),
  created_at timestamptz NOT NULL,
  created_at_iso text NOT NULL CHECK (created_at_iso ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,3})?)?(Z|[+-][0-9]{2}:[0-9]{2})$'),
  updated_at timestamptz NOT NULL,
  updated_at_iso text NOT NULL CHECK (updated_at_iso ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,3})?)?(Z|[+-][0-9]{2}:[0-9]{2})$'),
  deleted_at timestamptz,
  CHECK (
    status = 'estimated'
    OR (
      status = 'verified'
      AND verified_source IS NOT NULL
      AND length(btrim(verified_source)) > 0
      AND verified_at IS NOT NULL
    )
  )
);

CREATE INDEX site_spaces_site_idx ON site_spaces (site_id) WHERE deleted_at IS NULL;
