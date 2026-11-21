-- A retired Universe row points at the row that owns the place.
-- The row stays. It is not deleted.

ALTER TABLE universe_rows ADD COLUMN IF NOT EXISTS merged_into text NOT NULL DEFAULT '';
