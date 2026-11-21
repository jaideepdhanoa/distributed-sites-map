-- Real clock for an app event. Null means use created_at.
-- Snapshot changes are not stored here. They stay dated to the refresh.

ALTER TABLE queue_events ADD COLUMN IF NOT EXISTS event_at timestamptz;
