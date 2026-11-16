-- Search documents, agent-feed columns, and Gmail ids on comms.
-- The application does not index identity fields for the quarantined site.
-- Gmail ids stay in these columns. They are not part of the comms payload,
-- so the workbook mirror never sees them.

ALTER TABLE comms_entries ADD COLUMN IF NOT EXISTS message_id text;
ALTER TABLE comms_entries ADD COLUMN IF NOT EXISTS thread_id text;
ALTER TABLE comms_entries ADD COLUMN IF NOT EXISTS link text;
ALTER TABLE comms_entries ADD COLUMN IF NOT EXISTS gmail_message_id text;
ALTER TABLE comms_entries ADD COLUMN IF NOT EXISTS gmail_thread_id text;

ALTER TABLE activities ADD COLUMN IF NOT EXISTS at_approximate boolean NOT NULL DEFAULT false;

ALTER TABLE comms_entries DROP CONSTRAINT IF EXISTS comms_gmail_message_id_check;
ALTER TABLE comms_entries ADD CONSTRAINT comms_gmail_message_id_check
  CHECK (gmail_message_id IS NULL OR gmail_message_id ~ '^[0-9a-f]{16}$');

ALTER TABLE comms_entries DROP CONSTRAINT IF EXISTS comms_gmail_thread_id_check;
ALTER TABLE comms_entries ADD CONSTRAINT comms_gmail_thread_id_check
  CHECK (gmail_thread_id IS NULL OR gmail_thread_id ~ '^[0-9a-f]{16}$');

CREATE TABLE IF NOT EXISTS search_docs (
  doc_type text NOT NULL CHECK (doc_type IN ('site', 'broker', 'comms', 'note', 'intel', 'activity', 'pnl_line')),
  entity_id text NOT NULL,
  site_id text NOT NULL DEFAULT '',
  broker_id text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  visibility text NOT NULL CHECK (visibility IN ('public', 'signed-in', 'jaideep-only')),
  content_hash text NOT NULL DEFAULT '',
  embedded_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(body, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(entity_id, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(site_id, '')), 'A') ||
    setweight(to_tsvector('simple', replace(coalesce(entity_id, '') || ' ' || coalesce(site_id, ''), '-', ' ')), 'A')
  ) STORED,
  PRIMARY KEY (doc_type, entity_id)
);

CREATE INDEX IF NOT EXISTS search_docs_fts_idx ON search_docs USING gin (search_vector);
CREATE INDEX IF NOT EXISTS search_docs_site_idx ON search_docs (site_id);

-- pg_trgm and pgvector are on Neon. A database without the extension still
-- has the full-text index, and search keeps working.
DO $trgm$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS search_docs_title_trgm_idx ON search_docs USING gin (title gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS search_docs_entity_trgm_idx ON search_docs USING gin (entity_id gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  NULL;
END
$trgm$;

DO $vec$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
  ALTER TABLE search_docs ADD COLUMN IF NOT EXISTS embedding halfvec(1536);
  CREATE INDEX IF NOT EXISTS search_docs_embedding_idx ON search_docs USING hnsw (embedding halfvec_cosine_ops);
EXCEPTION WHEN OTHERS THEN
  NULL;
END
$vec$;

ALTER TABLE agent_inbox ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'muse';
ALTER TABLE agent_inbox ADD COLUMN IF NOT EXISTS before_text text NOT NULL DEFAULT '';
ALTER TABLE agent_inbox ADD COLUMN IF NOT EXISTS after_text text NOT NULL DEFAULT '';
ALTER TABLE agent_inbox ADD COLUMN IF NOT EXISTS run_id text NOT NULL DEFAULT '';

ALTER TABLE agent_inbox DROP CONSTRAINT IF EXISTS agent_inbox_audience_check;
ALTER TABLE agent_inbox ADD CONSTRAINT agent_inbox_audience_check
  CHECK (audience IN ('muse', 'indie', 'both'));

-- Keep kinds added by any migration that already ran, and add the feed kinds.
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
    AND rel.relname = 'agent_inbox'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%kind%';

  IF cons_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE agent_inbox DROP CONSTRAINT %I', cons_name);
  END IF;

  SELECT string_agg(quote_literal(t), ', ' ORDER BY t)
    INTO list
  FROM (
    SELECT DISTINCT t
    FROM (
      SELECT unnest(ARRAY[
        'note', 'reply', 'mention', 'suggestion', 'flag', 'decision', 'ask_gap',
        'proposal_ready', 'proposal_overtaken', 'proposal_closed',
        'data_change', 'check_failed', 'stale', 'broker_match'
      ]) AS t
      UNION
      SELECT m[1]
      FROM regexp_matches(COALESCE(def, ''), '''([a-z0-9_]+)''', 'g') AS m
      WHERE m[1] NOT IN ('text', 'public', 'integer', 'numeric')
    ) found
  ) uniq;

  EXECUTE 'ALTER TABLE agent_inbox ADD CONSTRAINT agent_inbox_kind_check CHECK (kind IN (' || list || '))';
END $$;
