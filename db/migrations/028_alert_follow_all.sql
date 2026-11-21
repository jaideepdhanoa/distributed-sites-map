-- Owner follow-all. Null means "use the account default" (on for the owner, off otherwise).
-- No queue_follows rows are written for this setting.

ALTER TABLE alert_preferences ADD COLUMN IF NOT EXISTS follow_all text;

ALTER TABLE alert_preferences DROP CONSTRAINT IF EXISTS alert_preferences_follow_all;
ALTER TABLE alert_preferences ADD CONSTRAINT alert_preferences_follow_all CHECK (
  follow_all IS NULL OR follow_all IN ('on', 'off')
);
