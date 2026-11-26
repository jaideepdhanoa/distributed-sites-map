CREATE TABLE charging_case_revisions (
  site_id text NOT NULL,
  case_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  request_id uuid NOT NULL UNIQUE,
  name text NOT NULL,
  author text NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  model_version text NOT NULL,
  source_revision text NOT NULL,
  selection_intent boolean NOT NULL,
  expected_selection text,
  inputs jsonb NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY (site_id, case_id, revision)
);
CREATE TABLE charging_site_case (
  site_id text PRIMARY KEY,
  case_id uuid NOT NULL,
  revision integer NOT NULL,
  FOREIGN KEY (site_id, case_id, revision) REFERENCES charging_case_revisions
);
