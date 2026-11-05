CREATE TABLE notes (
  id text PRIMARY KEY,
  target_kind text NOT NULL CHECK (target_kind IN ('site', 'deal')),
  target_id text NOT NULL,
  body text NOT NULL,
  author_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE suggestions (
  id text PRIMARY KEY,
  target_kind text NOT NULL CHECK (target_kind IN ('site', 'deal')),
  target_id text NOT NULL,
  field_name text NOT NULL,
  detail text,
  current_value text NOT NULL DEFAULT '',
  proposed_value text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'accepted', 'rejected', 'applied')),
  author_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  applied_at timestamptz
);

CREATE TABLE saved_views (
  id text PRIMARY KEY,
  name text NOT NULL,
  url_query text NOT NULL,
  owner_id text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('personal', 'team')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor_id text NOT NULL,
  action text NOT NULL,
  target_kind text,
  target_id text,
  before_json jsonb,
  after_json jsonb
);

CREATE INDEX notes_target_idx ON notes (target_kind, target_id, created_at);
CREATE INDEX suggestions_target_idx ON suggestions (target_kind, target_id, status);
CREATE INDEX suggestions_status_idx ON suggestions (status, created_at);
CREATE INDEX saved_views_owner_idx ON saved_views (owner_id, scope);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);
