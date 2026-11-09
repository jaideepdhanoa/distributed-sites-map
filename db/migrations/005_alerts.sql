CREATE TABLE alert_preferences (
  user_id text PRIMARY KEY,
  approvals text NOT NULL,
  mentions text NOT NULL,
  replies text NOT NULL,
  flags text NOT NULL,
  assignments text NOT NULL,
  followed text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alert_preferences_mode CHECK (
    approvals IN ('instant', 'digest', 'off')
    AND mentions IN ('instant', 'digest', 'off')
    AND replies IN ('instant', 'digest', 'off')
    AND flags IN ('instant', 'digest', 'off')
    AND assignments IN ('instant', 'digest', 'off')
    AND followed IN ('instant', 'digest', 'off')
  )
);

CREATE TABLE alert_outbox (
  id text PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  user_id text NOT NULL,
  to_email text NOT NULL,
  category text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('instant', 'digest')),
  site_id text NOT NULL,
  site_label text NOT NULL,
  summary text NOT NULL,
  author_id text NOT NULL,
  href text NOT NULL,
  ref_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending',
  batch_key text
);

CREATE INDEX alert_outbox_pending_idx ON alert_outbox (channel, status, user_id, created_at);

CREATE TABLE alert_log (
  id text PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  user_id text NOT NULL,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL,
  warning text NOT NULL DEFAULT '',
  sent_on text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE alert_digest_runs (
  user_id text PRIMARY KEY,
  sent_on text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);
