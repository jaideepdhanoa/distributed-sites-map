-- Close an open proposal without deciding the stage.
-- Existing rows stay on their current status. This file does not rewrite rows.

ALTER TABLE suggestions DROP CONSTRAINT IF EXISTS suggestions_status_check;
ALTER TABLE suggestions ADD CONSTRAINT suggestions_status_check
  CHECK (status IN (
    'open', 'accepted', 'rejected', 'applied', 'agreed_waiting', 'ready', 'overtaken', 'superseded'
  ));

ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS closed_by text;
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS closed_at text;
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS close_reason text;

ALTER TABLE agent_inbox DROP CONSTRAINT IF EXISTS agent_inbox_kind_check;
ALTER TABLE agent_inbox ADD CONSTRAINT agent_inbox_kind_check
  CHECK (kind IN (
    'note', 'reply', 'mention', 'suggestion', 'flag', 'decision', 'ask_gap',
    'proposal_ready', 'proposal_overtaken', 'proposal_closed'
  ));
