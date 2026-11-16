-- Per-user list sheet layout. Apply with the Production migrations workflow.
-- A request must not create this table on the production database.

CREATE TABLE IF NOT EXISTS list_layouts (
  user_id text NOT NULL,
  surface text NOT NULL,
  layout jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, surface),
  CONSTRAINT list_layouts_surface CHECK (surface IN ('pipeline', 'universe'))
);
