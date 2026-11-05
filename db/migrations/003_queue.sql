CREATE TABLE queue_events (
  id text PRIMARY KEY,
  site_id text NOT NULL,
  type text NOT NULL,
  summary text NOT NULL,
  actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ref_id text
);

CREATE TABLE queue_reviews (
  user_id text NOT NULL,
  site_id text NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, site_id)
);

CREATE TABLE queue_snoozes (
  user_id text NOT NULL,
  site_id text NOT NULL,
  until_date date NOT NULL,
  PRIMARY KEY (user_id, site_id)
);

CREATE TABLE queue_flags (
  id text PRIMARY KEY,
  site_id text NOT NULL,
  from_user text NOT NULL,
  to_user text NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  cleared_at timestamptz
);

CREATE TABLE queue_follows (
  user_id text NOT NULL,
  site_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, site_id)
);

CREATE INDEX queue_events_site_idx ON queue_events (site_id, created_at);
CREATE INDEX queue_flags_to_idx ON queue_flags (to_user, cleared_at);
