CREATE TABLE agent_inbox (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('note', 'reply', 'mention', 'suggestion', 'flag', 'decision', 'ask_gap')),
  subtype text,
  ref_id text NOT NULL,
  site_id text NOT NULL,
  record_id text NOT NULL DEFAULT '',
  actor text NOT NULL,
  body text NOT NULL,
  thread_key text NOT NULL,
  thread_context text NOT NULL DEFAULT '',
  proposal_id text,
  proposal_status text,
  stage text,
  workbook_stage boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'picked', 'done', 'superseded')),
  idempotency_key text NOT NULL UNIQUE
);

CREATE INDEX agent_inbox_cursor_idx ON agent_inbox (created_at, id);
CREATE INDEX agent_inbox_thread_idx ON agent_inbox (thread_key, status);
CREATE INDEX agent_inbox_record_idx ON agent_inbox (record_id, site_id);

CREATE TABLE agent_recommendations (
  id text PRIMARY KEY,
  inbox_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('reply', 'decision')),
  draft_text text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approve', 'reject', 'none')),
  rationale text NOT NULL,
  sources jsonb NOT NULL,
  confidence text NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  dismissed_at timestamptz,
  used_at timestamptz
);

CREATE INDEX agent_recommendations_inbox_idx ON agent_recommendations (inbox_id, created_at DESC);

ALTER TABLE notes ADD COLUMN recommendation_id text;
ALTER TABLE notes ADD COLUMN drafted_by_agent text;

ALTER TABLE suggestions ADD COLUMN recommendation_id text;
ALTER TABLE suggestions ADD COLUMN drafted_by_agent text;

CREATE TABLE ask_log (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  scope text NOT NULL,
  site_id text,
  question text NOT NULL,
  tools jsonb NOT NULL DEFAULT '[]',
  sources jsonb NOT NULL DEFAULT '[]',
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  estimated_cost numeric NOT NULL DEFAULT 0,
  unanswered boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ask_log_created_idx ON ask_log (created_at DESC);
CREATE INDEX ask_log_user_idx ON ask_log (user_id, created_at DESC);
