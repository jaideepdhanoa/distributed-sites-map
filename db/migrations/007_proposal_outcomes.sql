-- Additive proposal outcomes. Existing rows stay on their current status.
-- This file does not rewrite rows. Open proposals are not decided here.

ALTER TABLE suggestions DROP CONSTRAINT IF EXISTS suggestions_status_check;
ALTER TABLE suggestions ADD CONSTRAINT suggestions_status_check
  CHECK (status IN ('open', 'accepted', 'rejected', 'applied', 'agreed_waiting', 'ready', 'overtaken'));

ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS stage_at text;

CREATE TABLE IF NOT EXISTS proposal_blockers (
  id text PRIMARY KEY,
  suggestion_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('document_request', 'checklist', 'hold')),
  ref_id text NOT NULL DEFAULT '',
  label text NOT NULL,
  party text NOT NULL DEFAULT '',
  asked_on date,
  follow_up_on date,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS proposal_blockers_ref_idx
  ON proposal_blockers (suggestion_id, kind, ref_id);
CREATE INDEX IF NOT EXISTS proposal_blockers_suggestion_idx
  ON proposal_blockers (suggestion_id, closed_at);

ALTER TABLE agent_inbox DROP CONSTRAINT IF EXISTS agent_inbox_kind_check;
ALTER TABLE agent_inbox ADD CONSTRAINT agent_inbox_kind_check
  CHECK (kind IN (
    'note', 'reply', 'mention', 'suggestion', 'flag', 'decision', 'ask_gap',
    'proposal_ready', 'proposal_overtaken'
  ));

ALTER TABLE agent_recommendations DROP CONSTRAINT IF EXISTS agent_recommendations_kind_check;
ALTER TABLE agent_recommendations ADD CONSTRAINT agent_recommendations_kind_check
  CHECK (kind IN ('reply', 'decision', 'status_reply'));

ALTER TABLE agent_recommendations DROP CONSTRAINT IF EXISTS agent_recommendations_decision_check;
ALTER TABLE agent_recommendations ADD CONSTRAINT agent_recommendations_decision_check
  CHECK (decision IN ('approve', 'reject', 'none', 'agree_waiting', 'close_overtaken'));
