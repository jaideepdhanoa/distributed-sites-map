-- Core site record for Pipeline (PIPE-*) and Land Sites (LAND-*).
-- The map still reads the workbook snapshot until READ_SITES_FROM_DB is on
-- together with CHANGES_API_ENABLED. Financial claims, the NDA queue, the
-- email timeline, and open loops stay out of this table.
-- Score weights live in scoring_config. This migration does not recompute a score.

DO $$
DECLARE
  cons_name text;
BEGIN
  SELECT con.conname INTO cons_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'events'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%entity_type%';
  IF cons_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE events DROP CONSTRAINT %I', cons_name);
  END IF;
END $$;

ALTER TABLE events ADD CONSTRAINT events_entity_type_check
  CHECK (entity_type IN ('stage', 'activity', 'comms', 'site'));

CREATE TABLE sites (
  site_id text PRIMARY KEY,
  name text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  market text NOT NULL DEFAULT '',
  lat text NOT NULL DEFAULT '',
  lng text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  broker text NOT NULL DEFAULT '',
  firm text NOT NULL DEFAULT '',
  listing_url text NOT NULL DEFAULT '',
  asking_price text NOT NULL DEFAULT '',
  acreage text NOT NULL DEFAULT '',
  apn text NOT NULL DEFAULT '',
  land_value text NOT NULL DEFAULT '',
  improvement_value text NOT NULL DEFAULT '',
  county_value text NOT NULL DEFAULT '',
  county_value_basis text NOT NULL DEFAULT '',
  service_area_class text NOT NULL DEFAULT '',
  service_area_distance_mi text NOT NULL DEFAULT '',
  service_area_polygon text NOT NULL DEFAULT '',
  miles_to_depot text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  photo_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  photo_status text NOT NULL DEFAULT '',
  photo_diligence_count text NOT NULL DEFAULT '',
  photo_listing_count text NOT NULL DEFAULT '',
  photos_checked text NOT NULL DEFAULT '',
  photo_notes text NOT NULL DEFAULT '',
  universe_id text NOT NULL DEFAULT '',
  listing_status text NOT NULL DEFAULT '',
  score text NOT NULL DEFAULT '',
  location_points text NOT NULL DEFAULT '',
  coord_status text NOT NULL DEFAULT '',
  -- Raw workbook cells, keyed by header. The mirror writes only this map.
  sheet jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Sources and measures the scorecard reads. Not a second copy of the cleaned card.
  facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  fact_sources jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL CHECK (version >= 1),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by text NOT NULL
);

-- Version 1 is the current 100-point card. Location points are the rule.
-- Nothing in this table is applied to a stored score.
CREATE TABLE scoring_config (
  version integer PRIMARY KEY CHECK (version >= 1),
  economics integer NOT NULL,
  land integer NOT NULL,
  power integer NOT NULL,
  location integer NOT NULL,
  deal integer NOT NULL,
  location_points jsonb NOT NULL,
  CHECK (economics + land + power + location + deal = 100)
);

INSERT INTO scoring_config (version, economics, land, power, location, deal, location_points)
VALUES (
  1,
  40,
  25,
  15,
  10,
  10,
  '{"Inside":10,"Near 0-5":5,"Near 5-10":2.5,"Outside":0}'::jsonb
);
