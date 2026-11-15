-- Shadow event log for stage, activity, and comms.
-- The site still reads workbook snapshots. Nothing in this migration
-- changes what the map displays. events is append-only. The three current
-- tables are projections written in the same transaction as the event that
-- produced them. version is the optimistic-concurrency counter.

CREATE TABLE runs (
  id text PRIMARY KEY,
  actor text NOT NULL CHECK (length(btrim(actor)) > 0),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text NOT NULL DEFAULT ''
);

CREATE TABLE events (
  id text PRIMARY KEY,
  entity_type text NOT NULL CHECK (entity_type IN ('stage', 'activity', 'comms')),
  entity_id text NOT NULL,
  site_id text NOT NULL DEFAULT '',
  payload jsonb NOT NULL,
  source text NOT NULL CHECK (length(btrim(source)) > 0),
  actor text NOT NULL CHECK (length(btrim(actor)) > 0),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  run_id text REFERENCES runs (id)
);

CREATE INDEX events_entity_idx ON events (entity_type, entity_id, created_at);
CREATE INDEX events_site_idx ON events (site_id, created_at);
CREATE INDEX events_run_idx ON events (run_id);

CREATE TABLE site_stages (
  site_id text PRIMARY KEY,
  market text NOT NULL DEFAULT '',
  stage text NOT NULL,
  service_area_class text NOT NULL DEFAULT '',
  reason text NOT NULL DEFAULT '',
  version integer NOT NULL CHECK (version >= 1),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by text NOT NULL
);

CREATE TABLE activities (
  entity_id text PRIMARY KEY,
  site_id text NOT NULL DEFAULT '',
  payload jsonb NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by text NOT NULL
);

CREATE INDEX activities_site_idx ON activities (site_id);

CREATE TABLE comms_entries (
  entity_id text PRIMARY KEY,
  site_id text NOT NULL DEFAULT '',
  payload jsonb NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by text NOT NULL
);

CREATE INDEX comms_entries_site_idx ON comms_entries (site_id);

-- One row per successful API batch. A replay with the same body returns this
-- response and does not insert another event.
CREATE TABLE change_receipts (
  idempotency_key text PRIMARY KEY,
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE id_counters (
  name text PRIMARY KEY,
  value integer NOT NULL CHECK (value >= 0)
);

CREATE FUNCTION events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER events_no_update
  BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION events_append_only();

CREATE TRIGGER events_no_truncate
  BEFORE TRUNCATE ON events
  FOR EACH STATEMENT EXECUTE FUNCTION events_append_only();
