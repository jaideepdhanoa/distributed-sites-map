-- Comments on a followed site. Null means "use the role default".
-- Existing preference rows are not rewritten.

ALTER TABLE alert_preferences ADD COLUMN IF NOT EXISTS comments text;

ALTER TABLE alert_preferences DROP CONSTRAINT IF EXISTS alert_preferences_mode;
ALTER TABLE alert_preferences ADD CONSTRAINT alert_preferences_mode CHECK (
  approvals IN ('instant', 'digest', 'off')
  AND mentions IN ('instant', 'digest', 'off')
  AND replies IN ('instant', 'digest', 'off')
  AND flags IN ('instant', 'digest', 'off')
  AND assignments IN ('instant', 'digest', 'off')
  AND followed IN ('instant', 'digest', 'off')
  AND (recommendations IS NULL OR recommendations IN ('instant', 'digest', 'off'))
  AND (proposals IS NULL OR proposals IN ('instant', 'digest', 'off'))
  AND (decisions IS NULL OR decisions IN ('instant', 'digest', 'off'))
  AND (stages IS NULL OR stages IN ('instant', 'digest', 'off'))
  AND (asks IS NULL OR asks IN ('instant', 'digest', 'off'))
  AND (comments IS NULL OR comments IN ('instant', 'digest', 'off'))
);
