-- Photo bytes named by the live snapshot. Site rows move with each publish.
-- The image files otherwise exist only in the deploy that was current when
-- they were committed, so a newer snapshot can point at a file this build
-- does not contain. One row per file name. Bytes are not versioned.

CREATE TABLE IF NOT EXISTS photo_files (
  name text PRIMARY KEY CHECK (name ~ '^[a-f0-9]{20}\.(jpe?g|png|webp|gif)$'),
  content_type text NOT NULL,
  sha256 text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 8388608),
  bytes bytea NOT NULL,
  stored_at timestamptz NOT NULL DEFAULT now()
);
