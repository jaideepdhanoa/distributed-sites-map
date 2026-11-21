-- Universe-only census rows. A Quick lube shop from the census has no listing
-- and no Pipeline site. The address key replays the same Universe id.
-- Production applies this from the Production migrations workflow, not from CI.

ALTER TABLE universe_rows ADD COLUMN IF NOT EXISTS facts jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE universe_rows ADD COLUMN IF NOT EXISTS fact_sources jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE universe_rows ADD COLUMN IF NOT EXISTS service_area_class text NOT NULL DEFAULT '';
ALTER TABLE universe_rows ADD COLUMN IF NOT EXISTS miles_to_depot text NOT NULL DEFAULT '';
ALTER TABLE universe_rows ADD COLUMN IF NOT EXISTS address_key text NOT NULL DEFAULT '';
ALTER TABLE universe_rows ADD COLUMN IF NOT EXISTS request_hash text NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS universe_rows_market_address_key
  ON universe_rows (market, address_key)
  WHERE address_key <> '';
