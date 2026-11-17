-- Agent site create mints PIPE/LAND and Universe ids in one transaction.
-- A listing id (L-*) replays the same pair. Production does not apply this
-- file until the Production migrations workflow runs.

CREATE TABLE site_mints (
  listing_id text PRIMARY KEY CHECK (listing_id ~ '^L-[0-9]+$'),
  site_id text NOT NULL UNIQUE CHECK (site_id ~ '^(PIPE|LAND)-[A-Z]{2,4}-[0-9]{4,}$'),
  universe_id text NOT NULL UNIQUE CHECK (universe_id ~ '^WB-[A-Z]{2,4}-[0-9]{4,}$'),
  kind text NOT NULL CHECK (kind IN ('pipeline', 'land')),
  market text NOT NULL CHECK (market IN ('PHX', 'LAS', 'MIA')),
  request_hash text NOT NULL,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE universe_rows (
  universe_id text PRIMARY KEY,
  market text NOT NULL,
  site_id text NOT NULL,
  name text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  apn text NOT NULL DEFAULT '',
  lat text NOT NULL DEFAULT '',
  lng text NOT NULL DEFAULT '',
  listing_url text NOT NULL DEFAULT '',
  broker text NOT NULL DEFAULT '',
  listing_id text NOT NULL DEFAULT '',
  counted text NOT NULL DEFAULT 'Yes',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX universe_rows_site_idx ON universe_rows (site_id);
