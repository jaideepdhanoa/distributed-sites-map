-- Workbook snapshots. The sync job inserts a staged row, then marks it live
-- in the same transaction. A replaced live row becomes archived. The app
-- reads the one live row. Failed is reserved for a publish that was recorded
-- and then rejected; a rolled-back publish leaves no row.

CREATE TABLE IF NOT EXISTS snapshots (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  source_run_id text NOT NULL DEFAULT '',
  workbook_modified_at timestamptz,
  git_sha text NOT NULL DEFAULT '',
  row_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('staged', 'live', 'failed', 'archived'))
);

CREATE UNIQUE INDEX IF NOT EXISTS snapshots_one_live_idx
  ON snapshots (status) WHERE status = 'live';

CREATE INDEX IF NOT EXISTS snapshots_created_idx
  ON snapshots (created_at DESC, id DESC);

-- content is gzip-compressed file bytes, base64-encoded. bytes is the
-- uncompressed size. The text matches the file that build_data.py wrote.
CREATE TABLE IF NOT EXISTS snapshot_files (
  snapshot_id text NOT NULL REFERENCES snapshots (id) ON DELETE CASCADE,
  name text NOT NULL,
  content text NOT NULL,
  bytes integer NOT NULL,
  sha256 text NOT NULL,
  PRIMARY KEY (snapshot_id, name)
);
