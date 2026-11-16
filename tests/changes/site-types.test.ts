import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { closePool, withSql } from "../../lib/actions/db";
import { migrate } from "../../lib/actions/migrate";
import { importChanged } from "../../lib/changes/backfill";
import { typeMismatches } from "../../lib/changes/parity";
import { readDeals } from "../../lib/changes/read";
import { sitesFromFiles } from "../../lib/changes/site";
import { folderHref, listingHref } from "../../lib/format";
import { checkedPhrase, checkedShort } from "../../lib/keyNumbers";
import { installSnapshotForTests, resetSnapshotForTests } from "../../lib/snapshot/read";

const FOLDER = "https://drive.google.com/drive/folders/FixtureToken";

function shell(extra: Record<string, unknown>) {
  return {
    name: "Fixture wash",
    address: "1 Fixture St",
    city: "PHX",
    stage: "1 Desk screen",
    stage_group: "desk",
    business_type: "Car wash",
    broker: "",
    firm: "",
    listing_url: "",
    asking_price: null,
    asking_price_display: null,
    land_acres: null,
    apn: "",
    next_step: "",
    universe_id: "",
    coord_status: "",
    miles_to_depot: null,
    service_area_class: "",
    service_area_distance_mi: null,
    service_area_polygon: "",
    score: null,
    location_points: null,
    photos: [],
    photo_status: "",
    photo_diligence_count: null,
    photo_listing_count: null,
    photos_checked: "",
    photo_notes: "",
    listed: false,
    listing_removed: false,
    price_per_acre: null,
    folder_url: "",
    checked_live: null,
    asking_price_source: "",
    land_acres_basis: "",
    parcel_acres: null,
    parcel_match: "",
    open_land_sqft: null,
    open_land_basis: "",
    bays_that_fit: null,
    source_kind: "",
    source_line: "",
    site_capacity: "",
    cap_a_substation_mi: null,
    cap_a_line_ft: null,
    cap_a_source: "",
    cap_a_as_of: "",
    cap_a_confidence: "",
    cap_b_feeder: "",
    cap_b_frontage: null,
    cap_b_nearby: null,
    cap_b_horizon: "",
    cap_b_source: "",
    cap_b_as_of: "",
    cap_b_confidence: "",
    cap_c_amps: null,
    cap_c_volts: null,
    cap_c_phase: "",
    cap_c_panels: null,
    cap_c_source: "",
    cap_c_as_of: "",
    cap_c_confidence: "",
    cap_d_peak: null,
    cap_d_year: null,
    cap_d_source: "",
    cap_d_as_of: "",
    cap_d_confidence: "",
    trade_aadt: null,
    trade_aadt_road: "",
    trade_aadt_m: null,
    trade_aadt_max: null,
    trade_population: null,
    trade_growth: null,
    trade_income: null,
    trade_washes_1mi: null,
    trade_washes_3mi: null,
    ...extra,
  };
}

function fixtureFile() {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: null,
        properties: shell({
          deal_id: "PIPE-TST-0001",
          kind: "pipeline",
          service_area_class: "inside",
          in_area: true,
          land_acres: 2,
          parcel_acres: 1,
          bays_that_fit: 4,
          cap_a_substation_mi: 1.5,
          folder_url: FOLDER,
          checked_live: "2026-01-15",
          cap_a_as_of: "2026-02-03",
          cap_b_as_of: "2026-03-04",
          cap_c_as_of: "2026-04-05",
          cap_d_as_of: "2026-05-06",
          trade_aadt_road: "Sample Road 7",
          cap_b_feeder: "Feeder 12",
          cap_b_horizon: "5 year",
          cap_c_phase: "3-phase",
          site_capacity: "tier 2",
          asking_price_source: "Fixture",
        }),
      },
      {
        type: "Feature",
        geometry: null,
        properties: shell({
          deal_id: "LAND-TST-0001",
          kind: "land",
        }),
      },
    ],
  };
}

test("folderHref and daySpan accept a number", () => {
  assert.equal(folderHref(1234567890), "");
  assert.equal(folderHref(FOLDER), FOLDER);
  assert.equal(listingHref(1234567890), "");
  assert.doesNotThrow(() => checkedPhrase(20260115));
  assert.doesNotThrow(() => checkedShort(20260115));
  assert.equal(checkedPhrase(20260115), "");
  assert.equal(checkedShort(20260115), "");
  assert.equal(checkedPhrase("2026-01-15", new Date(2026, 0, 15)), "Checked live today");
});

test("readDeals keeps snapshot key types when the site flag is on", { timeout: 60_000 }, async () => {
  const saved = {
    read: process.env.READ_SITES_FROM_DB,
    api: process.env.CHANGES_API_ENABLED,
    env: process.env.VERCEL_ENV,
    database: process.env.DATABASE_URL,
  };
  const db = new PGlite();
  const server = new PGLiteSocketServer({ db, host: "127.0.0.1", port: 0, maxConnections: 4 });
  await server.start();
  const address = server.getServerConn();
  process.env.DATABASE_URL = `postgres://postgres:postgres@${address}/postgres`;
  process.env.CHANGES_API_ENABLED = "1";
  delete process.env.VERCEL_ENV;
  process.env.READ_SITES_FROM_DB = "0";
  await closePool();
  const file = fixtureFile();
  try {
    const deals = JSON.stringify(file);
    const sites = sitesFromFiles(deals);
    await withSql(async (sql) => {
      await migrate(sql);
      const imported = await importChanged(sql, { stages: [], activities: [], comms: [], sites }, "fixture-types");
      assert.equal(imported.inserted.site, 2);
      await sql.query("UPDATE sites SET name = $1 WHERE site_id = $2", ["From database", "PIPE-TST-0001"]);
    });
    installSnapshotForTests({
      id: "fixture-types",
      createdAt: "2026-01-01T00:00:00.000Z",
      files: { "deals.geojson": deals },
    });
    const off = await readDeals();
    process.env.READ_SITES_FROM_DB = "1";
    const on = await readDeals();
    const offFeatures = off.features || [];
    const onFeatures = on.features || [];
    assert.equal(offFeatures.length, 2);
    assert.equal(onFeatures.length, 2);
    const mismatches = [
      ...typeMismatches(offFeatures[0], onFeatures[0], "pipeline"),
      ...typeMismatches(offFeatures[1], onFeatures[1], "land"),
    ];
    assert.deepEqual(mismatches, []);
    assert.equal(onFeatures[0]?.properties?.name, "From database");
    assert.equal(typeof onFeatures[0]?.properties?.folder_url, "string");
    assert.equal(typeof onFeatures[0]?.properties?.checked_live, "string");
    assert.equal(typeof onFeatures[0]?.properties?.cap_c_phase, "string");
    assert.equal(typeof onFeatures[0]?.properties?.trade_aadt_road, "string");
    assert.equal(typeof onFeatures[0]?.properties?.parcel_acres, "number");
    assert.equal(onFeatures[1]?.properties?.checked_live, null);
    assert.equal(onFeatures[1]?.properties?.open_land_sqft, null);
    assert.equal(onFeatures[1]?.properties?.kind, "land");
  } finally {
    resetSnapshotForTests();
    await closePool();
    await server.stop();
    if (saved.read === undefined) delete process.env.READ_SITES_FROM_DB;
    else process.env.READ_SITES_FROM_DB = saved.read;
    if (saved.api === undefined) delete process.env.CHANGES_API_ENABLED;
    else process.env.CHANGES_API_ENABLED = saved.api;
    if (saved.env === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = saved.env;
    if (saved.database === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved.database;
  }
});
