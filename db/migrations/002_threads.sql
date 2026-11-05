ALTER TABLE notes ADD COLUMN parent_id text;
ALTER TABLE notes ADD COLUMN updated_at timestamptz;
ALTER TABLE notes ADD COLUMN deleted_at timestamptz;
ALTER TABLE notes ADD COLUMN resolved_at timestamptz;
ALTER TABLE notes ADD COLUMN resolved_by text;

ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_target_kind_check;
ALTER TABLE notes ADD CONSTRAINT notes_target_kind_check CHECK (target_kind IN ('site', 'deal', 'suggestion'));

ALTER TABLE suggestions ADD COLUMN title text;
ALTER TABLE suggestions ADD COLUMN target_on date;
ALTER TABLE suggestions ADD COLUMN owner_id text;

CREATE INDEX notes_parent_idx ON notes (parent_id, created_at);
