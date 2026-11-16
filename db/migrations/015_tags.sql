-- Structured chips. Codes live here, not in the workbook.
-- The app does not apply this file to production. Jaideep runs the
-- Production migrations workflow. Legacy sheet cells are not changed.

DO $$
DECLARE
  cons_name text;
  def text;
  list text;
BEGIN
  SELECT con.conname, pg_get_constraintdef(con.oid)
    INTO cons_name, def
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

  -- Keep entity types already recorded, including site_space from 017, and add tag.
  SELECT string_agg(quote_literal(t), ', ' ORDER BY t)
    INTO list
  FROM (
    SELECT DISTINCT t
    FROM (
      SELECT unnest(ARRAY['stage', 'activity', 'comms', 'site', 'pnl_line', 'tag']) AS t
      UNION
      SELECT m[1]
      FROM regexp_matches(COALESCE(def, ''), '''([a-z0-9_]+)''', 'g') AS m
      WHERE m[1] NOT IN ('text', 'public', 'integer', 'numeric')
    ) found
  ) uniq;

  EXECUTE 'ALTER TABLE events ADD CONSTRAINT events_entity_type_check CHECK (entity_type IN (' || list || '))';
END $$;

CREATE TABLE tag_vocab (
  family text NOT NULL,
  code text NOT NULL,
  label text NOT NULL CHECK (length(btrim(label)) > 0),
  tone text NOT NULL CHECK (tone IN ('pine', 'brass', 'sky', 'sand')),
  help text NOT NULL DEFAULT '',
  owning_role text NOT NULL CHECK (owning_role IN ('muse', 'indie', 'reviewer', 'capture')),
  PRIMARY KEY (family, code)
);

INSERT INTO tag_vocab (family, code, label, tone, help, owning_role) VALUES
('waiting_on', 'broker_reply', 'Broker reply', 'brass', 'Waiting on a reply from the broker.', 'muse'),
  ('waiting_on', 'we_owe', 'Us/we owe a reply', 'brass', 'A reply is owed from our side.', 'muse'),
  ('waiting_on', 'nda_execution', 'NDA execution', 'brass', 'The stage is waiting on the NDA.', 'muse'),
  ('waiting_on', 'our_diligence', 'Our-side diligence', 'brass', 'The stage is waiting on our own checks.', 'muse'),
  ('waiting_on', 'nothing', 'nothing', 'pine', 'Nothing is blocking the stage.', 'muse'),
  ('drop_reason', 'lot_too_small', 'Lot too small', 'sand', 'The lot cannot fit the layout.', 'reviewer'),
  ('drop_reason', 'no_longer_for_sale', 'No longer for sale', 'sand', 'The seller took it off the market.', 'reviewer'),
  ('drop_reason', 'outside_service_area', 'Outside service area', 'sand', 'The site is outside the service area.', 'reviewer'),
  ('drop_reason', 'business_not_operating', 'Business not operating', 'sand', 'The business is not operating.', 'reviewer'),
  ('drop_reason', 'outside_markets', 'Outside our markets', 'sand', 'The site is outside the markets we cover.', 'reviewer'),
  ('drop_reason', 'tenant_lease', 'Tenant lease', 'sand', 'A tenant lease ties up the site.', 'reviewer'),
  ('drop_reason', 'price_vs_value', 'Price vs value', 'sand', 'The price does not match the value.', 'reviewer'),
  ('drop_reason', 'sold_to_another', 'Sold to another buyer', 'sand', 'Another buyer took the site.', 'reviewer'),
  ('drop_reason', 'duplicate', 'Duplicate', 'sand', 'The site repeats one we already have.', 'reviewer'),
  ('drop_reason', 'numbers_dont_work', 'Numbers don''t work', 'sand', 'The numbers do not clear the screen.', 'reviewer'),
  ('advance_reason', 'package_received', 'Package received', 'pine', 'The package is in hand.', 'reviewer'),
  ('advance_reason', 'numbers_clear', 'Numbers clear the screen', 'pine', 'The numbers clear the screen.', 'reviewer'),
  ('advance_reason', 'land_verified', 'Land verified', 'pine', 'The land check is verified.', 'reviewer'),
  ('advance_reason', 'power_confirmed', 'Power confirmed', 'pine', 'Power is confirmed.', 'reviewer'),
  ('advance_reason', 'broker_engaged', 'Broker engaged', 'pine', 'A broker is engaged.', 'reviewer'),
  ('diligence_price', 'verified', 'Verified', 'pine', 'Price check.', 'capture'),
  ('diligence_price', 'claimed', 'Claimed', 'brass', 'Price check.', 'capture'),
  ('diligence_price', 'estimated', 'Estimated', 'sky', 'Price check.', 'capture'),
  ('diligence_price', 'unknown', 'Unknown', 'sky', 'Price check.', 'capture'),
  ('diligence_price', 'problem', 'Problem', 'sand', 'Price check.', 'capture'),
  ('diligence_financials', 'verified', 'Verified', 'pine', 'Financials check.', 'capture'),
  ('diligence_financials', 'claimed', 'Claimed', 'brass', 'Financials check.', 'capture'),
  ('diligence_financials', 'estimated', 'Estimated', 'sky', 'Financials check.', 'capture'),
  ('diligence_financials', 'unknown', 'Unknown', 'sky', 'Financials check.', 'capture'),
  ('diligence_financials', 'problem', 'Problem', 'sand', 'Financials check.', 'capture'),
  ('diligence_land', 'verified', 'Verified', 'pine', 'Land check.', 'capture'),
  ('diligence_land', 'claimed', 'Claimed', 'brass', 'Land check.', 'capture'),
  ('diligence_land', 'estimated', 'Estimated', 'sky', 'Land check.', 'capture'),
  ('diligence_land', 'unknown', 'Unknown', 'sky', 'Land check.', 'capture'),
  ('diligence_land', 'problem', 'Problem', 'sand', 'Land check.', 'capture'),
  ('diligence_power', 'verified', 'Verified', 'pine', 'Power check.', 'capture'),
  ('diligence_power', 'claimed', 'Claimed', 'brass', 'Power check.', 'capture'),
  ('diligence_power', 'estimated', 'Estimated', 'sky', 'Power check.', 'capture'),
  ('diligence_power', 'unknown', 'Unknown', 'sky', 'Power check.', 'capture'),
  ('diligence_power', 'problem', 'Problem', 'sand', 'Power check.', 'capture'),
  ('diligence_zoning', 'verified', 'Verified', 'pine', 'Zoning check.', 'capture'),
  ('diligence_zoning', 'claimed', 'Claimed', 'brass', 'Zoning check.', 'capture'),
  ('diligence_zoning', 'estimated', 'Estimated', 'sky', 'Zoning check.', 'capture'),
  ('diligence_zoning', 'unknown', 'Unknown', 'sky', 'Zoning check.', 'capture'),
  ('diligence_zoning', 'problem', 'Problem', 'sand', 'Zoning check.', 'capture'),
  ('diligence_title', 'verified', 'Verified', 'pine', 'Title check.', 'capture'),
  ('diligence_title', 'claimed', 'Claimed', 'brass', 'Title check.', 'capture'),
  ('diligence_title', 'estimated', 'Estimated', 'sky', 'Title check.', 'capture'),
  ('diligence_title', 'unknown', 'Unknown', 'sky', 'Title check.', 'capture'),
  ('diligence_title', 'problem', 'Problem', 'sand', 'Title check.', 'capture'),
  ('diligence_environmental', 'verified', 'Verified', 'pine', 'Environmental check.', 'capture'),
  ('diligence_environmental', 'claimed', 'Claimed', 'brass', 'Environmental check.', 'capture'),
  ('diligence_environmental', 'estimated', 'Estimated', 'sky', 'Environmental check.', 'capture'),
  ('diligence_environmental', 'unknown', 'Unknown', 'sky', 'Environmental check.', 'capture'),
  ('diligence_environmental', 'problem', 'Problem', 'sand', 'Environmental check.', 'capture'),
  ('biggest_gap', 'spare_land', 'Spare land', 'brass', 'Spare land is the open question.', 'muse'),
  ('biggest_gap', 'power', 'Power', 'brass', 'Power is the open question.', 'muse'),
  ('biggest_gap', 'financials', 'Financials', 'brass', 'Financials are the open question.', 'muse'),
  ('biggest_gap', 'lease_tenure', 'Lease or tenure', 'brass', 'Lease or tenure is the open question.', 'muse'),
  ('biggest_gap', 'zoning', 'Zoning', 'brass', 'Zoning is the open question.', 'muse'),
  ('biggest_gap', 'title', 'Title', 'brass', 'Title is the open question.', 'muse'),
  ('biggest_gap', 'address', 'Address', 'brass', 'The address is the open question.', 'muse'),
  ('biggest_gap', 'price', 'Price', 'brass', 'Price is the open question.', 'muse'),
  ('biggest_gap', 'business_identity', 'Business identity', 'brass', 'The business identity is the open question.', 'muse'),
  ('next_action', 'follow_up', 'Follow up with broker', 'brass', 'Follow up with the broker.', 'muse'),
  ('next_action', 'request_package', 'Request package', 'brass', 'Ask for the package.', 'muse'),
  ('next_action', 'get_nda_signed', 'Get NDA signed', 'brass', 'Get the NDA signed.', 'muse'),
  ('next_action', 'measure_land', 'Measure land', 'brass', 'Measure the land.', 'muse'),
  ('next_action', 'check_power', 'Check power', 'brass', 'Check power.', 'muse'),
  ('next_action', 'review_financials', 'Review financials', 'brass', 'Review the financials.', 'muse'),
  ('next_action', 'decide', 'Decide', 'brass', 'Make the decision.', 'muse'),
  ('package', 'none', 'None', 'sky', 'No package is on file.', 'muse'),
  ('package', 'received', 'Received', 'pine', 'The package was received.', 'muse'),
  ('package', 'refused', 'Refused or unavailable', 'sand', 'The package was refused or is unavailable.', 'muse'),
  ('nda', 'not_required', 'Not required', 'pine', 'No NDA is required.', 'muse'),
  ('nda', 'moove_sent', 'Moove form sent', 'brass', 'The Moove form was sent.', 'muse'),
  ('nda', 'their_legal', 'With their legal', 'brass', 'The NDA is with their legal team.', 'muse'),
  ('nda', 'moove_legal', 'With Moove legal', 'brass', 'The NDA is with Moove legal.', 'muse'),
  ('business_check', 'operating_confirmed', 'Operating, address confirmed', 'pine', 'The business is operating and the address is confirmed.', 'capture'),
  ('business_check', 'operating_after_nda', 'Operating, address after NDA', 'brass', 'The business is operating. The address waits on the NDA.', 'capture'),
  ('business_check', 'not_confirmed', 'Not confirmed', 'sky', 'Operating status is not confirmed.', 'capture'),
  ('business_check', 'not_operating', 'Not operating', 'sand', 'The business is not operating.', 'capture'),
  ('listing', 'off_market', 'Off-market', 'sky', 'The site is off-market.', 'muse'),
  ('listing', 'listed', 'Listed', 'pine', 'The site is listed.', 'muse'),
  ('listing', 'sold_withdrawn', 'Sold or withdrawn', 'sand', 'The listing was sold or withdrawn.', 'muse'),
  ('lead_source', 'off_market', 'Off-market', 'sky', 'We found the site ourselves.', 'muse'),
  ('lead_source', 'broker', 'Broker', 'brass', 'A broker brought the site.', 'muse'),
  ('lead_source', 'listing', 'Listing', 'pine', 'The site came from a listing.', 'muse'),
  ('photos', 'complete', 'Complete', 'pine', 'The photo set is complete.', 'indie'),
  ('photos', 'deferred', 'Deferred', 'sky', 'Photos are deferred.', 'indie'),
  ('photos', 'partial', 'Partial', 'brass', 'The photo set is partial.', 'indie');

CREATE TABLE site_tags (
  site_id text NOT NULL,
  family text NOT NULL,
  code text NOT NULL,
  since timestamptz,
  since_iso text NOT NULL DEFAULT '' CHECK (
    since_iso = ''
    OR since_iso ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,3})?)?(Z|[+-][0-9]{2}:[0-9]{2})$'
  ),
  source_ref text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  owner text NOT NULL DEFAULT '',
  due_on text NOT NULL DEFAULT '' CHECK (due_on = '' OR due_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  actor text NOT NULL CHECK (length(btrim(actor)) > 0),
  version integer NOT NULL CHECK (version >= 1),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (site_id, family),
  FOREIGN KEY (family, code) REFERENCES tag_vocab (family, code)
);

CREATE INDEX site_tags_family_idx ON site_tags (family, code);

-- A drop is a person's decision. Existing rows are left as they are.
CREATE FUNCTION site_stages_dropped_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.stage = 'Dropped' THEN
    -- The workbook copy may land a historical Dropped row. A new decision may not.
    IF lower(btrim(COALESCE(NEW.updated_by, ''))) = 'workbook-sync' THEN
      RETURN NEW;
    END IF;
    IF length(btrim(COALESCE(NEW.reason, ''))) = 0 THEN
      RAISE EXCEPTION 'Dropped needs a reason';
    END IF;
    IF lower(btrim(COALESCE(NEW.updated_by, ''))) IN ('system', 'indie', 'muse', 'backfill') THEN
      RAISE EXCEPTION 'Dropped needs a human actor';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER site_stages_dropped_guard
  BEFORE INSERT OR UPDATE ON site_stages
  FOR EACH ROW EXECUTE FUNCTION site_stages_dropped_guard();
