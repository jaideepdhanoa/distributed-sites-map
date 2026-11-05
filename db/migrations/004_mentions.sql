CREATE TABLE mentions (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  site_id text NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('note', 'suggestion')),
  source_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  cleared_at timestamptz
);

CREATE INDEX mentions_user_idx ON mentions (user_id, cleared_at);
CREATE INDEX mentions_source_idx ON mentions (source_kind, source_id);

ALTER TABLE suggestions ADD COLUMN done_at timestamptz;
ALTER TABLE suggestions ADD COLUMN done_by text;
