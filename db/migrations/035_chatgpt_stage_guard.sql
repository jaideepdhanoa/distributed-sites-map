CREATE OR REPLACE FUNCTION site_stages_dropped_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.stage = 'Dropped' THEN
    -- The workbook copy may land a historical Dropped row. A new decision may not.
    IF lower(btrim(COALESCE(NEW.updated_by, ''))) = 'workbook-sync' THEN
      RETURN NEW;
    END IF;
    IF length(btrim(COALESCE(NEW.reason, ''))) = 0 THEN
      RAISE EXCEPTION 'Dropped needs a reason';
    END IF;
    IF lower(btrim(COALESCE(NEW.updated_by, ''))) IN ('system', 'indie', 'muse', 'chatgpt', 'backfill') THEN
      RAISE EXCEPTION 'Dropped needs a human actor';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
