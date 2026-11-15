import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { applyBatch, VersionConflictError } from "../../lib/changes/apply";
import { importChanged } from "../../lib/changes/backfill";
import { diffDatabase } from "../../lib/changes/diff";
import { importEntityFromWorkbook, readEntityFromDb } from "../../lib/changes/flags";
import { PROTECTED_ROW, PROTECTED_SITE_ID, planSiteMirror, type SheetTable } from "../../lib/changes/mirror";
import { applySiteRows } from "../../lib/changes/read";
import { validateBatch, type Actor } from "../../lib/changes/schema";
import { loadScorecard, recordedLocationPoints, recordedScore, scorecardTotal } from "../../lib/changes/scorecard";
import { emptySiteFields, type SiteRow } from "../../lib/changes/site";
import { workbookFromFiles } from "../../lib/changes/workbook";
import { memorySql } from "../helpers/sql";

const contributor: Actor = { id: "cindel", kind: "human", role: "contributor" };
const reviewer: Actor = { id: "jaideep", kind: "human", role: "reviewer" };
const viewer: Actor = { id: "guest", kind: "human", role: "viewer" };
const agent: Actor = { id: "muse", kind: "agent" };

function sheet(headers: string[], body: string[][]): SheetTable {
  return {
    title: "Pipeline",
    headerRow: 4,
    headers,
    rows: body.map((cells, index) => ({ row: 5 + index, cells })),
  };
}

function siteChange(payload: Record<string, unknown>, expected = 0) {
  return {
    entity_type: "site",
    site_id: "PIPE-PHX-0001",
    expected_version: expected,
    source: "desk note",
    payload,
  };
}

test("a contributor or agent can update site content, and stage stays off this path", async () => {
  assert.throws(() => validateBatch(viewer, "v", { changes: [siteChange({ name: "Sonoran" })] }), /do not have permission/);
  assert.throws(
    () => validateBatch(contributor, "stage", { changes: [siteChange({ stage: "Dropped", name: "Sonoran" })] }),
    /Stage is not written on a site/,
  );
  assert.throws(
    () => validateBatch(agent, "agent-stage", { changes: [siteChange({ Stage: "1 Desk screen", notes: "Hello" })] }),
    /Stage is not written on a site/,
  );
  assert.throws(
    () => validateBatch(contributor, "price", { changes: [siteChange({ asking_price: 1600000 })] }),
    /Every numeric fact needs a source/,
  );
  assert.throws(
    () =>
      validateBatch(contributor, "new-copy", {
        changes: [siteChange({ name: "Copy", folder_url: "https://drive.google.com/drive/folders/abc", photos: [] })],
      }),
    /does not copy Folder, photos, land evidence, typed power, check statuses, or financial claims/,
  );
  for (const extra of [
    { land_evidence: "from the neighbor" },
    { cap_c_amps: 400 },
    { checked_live: "2026-11-01" },
    { stated_revenue: 100 },
    { photo_notes: "copied" },
  ]) {
    assert.throws(
      () => validateBatch(contributor, "guard", { changes: [siteChange({ name: "Copy", ...extra })] }),
      /does not copy Folder/,
    );
  }
  assert.throws(
    () => validateBatch(reviewer, "score", { changes: [siteChange({ score: 10, name: "Sonoran" })] }),
    /That field is not accepted/,
  );
  assert.doesNotThrow(() =>
    validateBatch(agent, "agent-ok", {
      changes: [siteChange({ asking_price: 1600000, sources: { asking_price: "LoopNet listing" } }, 1)],
    }),
  );

  const sql = await memorySql();
  await migrate(sql);
  const created = await applyBatch(sql, contributor, "site-1", {
    changes: [siteChange({ name: "Sonoran Express", market: "PHX", asking_price: 1600000, sources: { asking_price: "LoopNet listing" } })],
  });
  assert.equal(created.results[0]?.entity_type, "site");
  assert.equal(created.results[0]?.version, 1);
  assert.equal(created.results[0]?.entity_id, "PIPE-PHX-0001");
  const row = await sql.query<{ name: string; asking_price: string; version: number | string; fact_sources: { asking_price?: string } }>(
    "SELECT name, asking_price, version, fact_sources FROM sites WHERE site_id = $1",
    ["PIPE-PHX-0001"],
  );
  assert.equal(row.rows[0]?.name, "Sonoran Express");
  assert.equal(row.rows[0]?.asking_price, "1600000");
  assert.equal(row.rows[0]?.fact_sources.asking_price, "LoopNet listing");

  await assert.rejects(
    () => applyBatch(sql, contributor, "site-conflict", { changes: [siteChange({ notes: "A public note", market: "PHX" })] }),
    (error: unknown) => error instanceof VersionConflictError,
  );
  const updated = await applyBatch(sql, contributor, "site-2", {
    changes: [siteChange({ notes: "A public note", lat: 33.39, sources: { lat: "listing pin" } }, 1)],
  });
  assert.equal(updated.results[0]?.version, 2);
  const kept = await sql.query<{ name: string; notes: string; lat: string }>(
    "SELECT name, notes, lat FROM sites WHERE site_id = $1",
    ["PIPE-PHX-0001"],
  );
  assert.equal(kept.rows[0]?.name, "Sonoran Express");
  assert.equal(kept.rows[0]?.notes, "A public note");
  assert.equal(kept.rows[0]?.lat, "33.39");
});

test("unknown site values are stored as written and listed in the diff", async () => {
  const sql = await memorySql();
  await migrate(sql);
  const row: SiteRow = {
    site_id: "PIPE-PHX-0008",
    ...emptySiteFields(),
    coord_status: "",
    sheet: "{}",
    facts: {},
    name: "Yard",
    market: "Phoenix",
    category: "Car wash",
    service_area_class: "Beside",
    photo_refs: "[]",
  };
  const imported = await importChanged(sql, { stages: [], activities: [], comms: [], sites: [row] }, "snap-unknown");
  assert.equal(imported.inserted.site, 1);
  assert.equal(imported.invalid.site, 1);
  const stored = await sql.query<{ market: string; service_area_class: string }>(
    "SELECT market, service_area_class FROM sites WHERE site_id = $1",
    ["PIPE-PHX-0008"],
  );
  assert.equal(stored.rows[0]?.market, "Phoenix");
  assert.equal(stored.rows[0]?.service_area_class, "Beside");
  const report = await diffDatabase(sql, { stages: [], activities: [], comms: [], sites: [row] }, "snap-unknown");
  assert.equal(report.clean, false);
  assert.deepEqual(
    report.invalid.site.map((issue) => issue.field).sort(),
    ["market", "service_area_class"],
  );
  assert.equal(report.entities.site.changed.length, 0);
});

test("the site read flag skips import and the overlay falls back to the snapshot shape", async () => {
  const saved = {
    read: process.env.READ_SITES_FROM_DB,
    api: process.env.CHANGES_API_ENABLED,
    env: process.env.VERCEL_ENV,
  };
  process.env.READ_SITES_FROM_DB = "1";
  process.env.CHANGES_API_ENABLED = "1";
  delete process.env.VERCEL_ENV;
  try {
    assert.equal(readEntityFromDb("site"), true);
    assert.equal(importEntityFromWorkbook("site"), false);
    const sql = await memorySql();
    await migrate(sql);
    const imported = await importChanged(
      sql,
      {
        stages: [],
        activities: [],
        comms: [],
        sites: [{ site_id: "PIPE-PHX-0001", ...emptySiteFields(), coord_status: "", sheet: "{}", facts: {}, name: "From sheet", market: "PHX", photo_refs: "[]" }],
      },
      "snap-flag",
    );
    assert.deepEqual(imported.cut_over, ["site"]);
    assert.equal(imported.inserted.site, 0);
  } finally {
    if (saved.read === undefined) delete process.env.READ_SITES_FROM_DB;
    else process.env.READ_SITES_FROM_DB = saved.read;
    if (saved.api === undefined) delete process.env.CHANGES_API_ENABLED;
    else process.env.CHANGES_API_ENABLED = saved.api;
    if (saved.env === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = saved.env;
  }

  const painted = applySiteRows(
    { features: [{ properties: { deal_id: "PIPE-PHX-0001", name: "Snapshot", stated_revenue: 10, nda_status: "Waiting" }, geometry: null }] },
    [{ site_id: "PIPE-PHX-0001", ...emptySiteFields(), name: "Database", market: "PHX", asking_price: "1600000", photo_refs: "[]" }],
  );
  const props = painted.features?.[0]?.properties || {};
  assert.equal(props.name, "Database");
  assert.equal(props.asking_price, 1600000);
  assert.equal(props.stated_revenue, 10);
  assert.equal(props.nda_status, "Waiting");
});

test("scores match the generated deals and the scorecard is not applied", { timeout: 120_000 }, async () => {
  const card = loadScorecard();
  assert.equal(card.version, 1);
  assert.equal(scorecardTotal(card), 100);
  assert.deepEqual(card.weights, { economics: 40, land: 25, power: 15, location: 10, deal: 10 });
  assert.deepEqual(card.location_points, { Inside: 10, "Near 0-5": 5, "Near 5-10": 2.5, Outside: 0 });
  assert.equal(recordedScore(72), 72);
  assert.equal(recordedLocationPoints(7.5), 7.5);
  assert.notEqual(recordedLocationPoints(7.5), card.location_points.Inside);

  const deals = readFileSync("data/generated/deals.geojson", "utf8");
  const pricing = readFileSync("data/generated/pricing.json", "utf8");
  const slice = workbookFromFiles({
    deals,
    timeline: "{\"items\":[]}",
    comms: "{\"rows\":[]}",
    pricing,
  });
  const sql = await memorySql();
  await migrate(sql);
  const config = await sql.query<{ economics: number; land: number; power: number; location: number; deal: number; location_points: ScorePoints }>(
    "SELECT economics, land, power, location, deal, location_points FROM scoring_config WHERE version = 1",
  );
  assert.equal(Number(config.rows[0]?.economics), 40);
  assert.equal(Number(config.rows[0]?.land), 25);
  assert.equal(Number(config.rows[0]?.power), 15);
  assert.equal(Number(config.rows[0]?.location), 10);
  assert.equal(Number(config.rows[0]?.deal), 10);
  assert.equal(Number(config.rows[0]?.location_points["Near 5-10"]), 2.5);

  const hand: SiteRow = {
    site_id: "PIPE-LAS-0099",
    ...emptySiteFields(),
    coord_status: "",
    sheet: "{}",
    facts: {},
    name: "Hand",
    market: "LAS",
    category: "Land",
    service_area_class: "inside",
    score: "72",
    location_points: "7.5",
    photo_refs: "[]",
  };
  const imported = await importChanged(
    sql,
    { stages: [], activities: [], comms: [], sites: [...(slice.sites || []), hand] },
    "snap-scores",
  );
  assert.equal(imported.inserted.site, (slice.sites || []).length + 1);
  const generated = JSON.parse(deals) as { features: { properties: { deal_id: string; score: number | null; location_points: number | null } }[] };
  const stored = await sql.query<{ site_id: string; score: string; location_points: string; county_value: string; land_value: string }>(
    "SELECT site_id, score, location_points, county_value, land_value FROM sites",
  );
  const byId = new Map(stored.rows.map((row) => [row.site_id, row]));
  for (const feature of generated.features) {
    const props = feature.properties;
    const row = byId.get(props.deal_id);
    assert.ok(row, props.deal_id);
    assert.equal(row?.score, props.score == null ? "" : String(props.score));
    assert.equal(row?.location_points, props.location_points == null ? "" : String(props.location_points));
  }
  const sourced = await sql.query<{ coord_status: string; fact_sources: { lat?: string; lng?: string } }>(
    "SELECT coord_status, fact_sources FROM sites WHERE coord_status IN ('geocoded', 'linked site') LIMIT 1",
  );
  if (sourced.rows[0]) {
    assert.equal(sourced.rows[0].fact_sources.lat, sourced.rows[0].coord_status);
    assert.notEqual(sourced.rows[0].fact_sources.lat, "workbook snapshot snap-scores");
  }
  const sample = byId.get("PIPE-PHX-0001");
  assert.equal(sample?.county_value, "2236814");
  assert.equal(sample?.land_value, "");
  const untouched = byId.get("PIPE-LAS-0099");
  assert.equal(untouched?.score, "72");
  assert.equal(untouched?.location_points, "7.5");
  assert.notEqual(untouched?.location_points, String(card.location_points.Inside));
});

test("a missing sites table leaves the other imports running", async () => {
  const sql = await memorySql();
  await migrate(sql);
  await sql.exec("DROP TABLE sites");
  const imported = await importChanged(
    sql,
    {
      stages: [{ site_id: "PIPE-PHX-0001", stage: "1 Desk screen", market: "PHX", service_area_class: "inside", reason: "" }],
      activities: [],
      comms: [],
      sites: [{ site_id: "PIPE-PHX-0001", ...emptySiteFields(), coord_status: "", sheet: "{}", facts: {}, name: "Later", market: "PHX", photo_refs: "[]" }],
    },
    "snap-old",
  );
  assert.deepEqual(imported.unmigrated, ["site"]);
  assert.equal(imported.inserted.site, 0);
  assert.equal(imported.inserted.stage, 1);
  const stage = await sql.query<{ stage: string }>("SELECT stage FROM site_stages WHERE site_id = $1", ["PIPE-PHX-0001"]);
  assert.equal(stage.rows[0]?.stage, "1 Desk screen");
});

test("the site mirror writes raw cells by header and skips row 10 and PIPE-PHX-0006", () => {
  const headers = ["Stage", "Folder", "Name", "Site ID", "Asking price ($)", "Next step"];
  const raw = {
    Name: "Sonoran Express",
    "Asking price ($)": "$1,600,000",
    "Next step": "Call the broker about the driveway. The package is in the folder.",
  };
  const pipeline = sheet(headers, [
    ["1 Desk screen", "https://drive.google.com/folder", raw.Name, "PIPE-PHX-0001", raw["Asking price ($)"], raw["Next step"]],
    ["Dropped", "secret", "Quarantine", PROTECTED_SITE_ID, "$1", "secret note"],
  ]);
  pipeline.rows[1].row = PROTECTED_ROW;
  const unchanged = planSiteMirror(
    [pipeline, { title: "Land Sites", headerRow: 4, headers, rows: [] }],
    [
      { site_id: "PIPE-PHX-0001", cells: raw },
      { site_id: PROTECTED_SITE_ID, cells: { Name: "Do not write" } },
    ],
  );
  assert.equal(unchanged.changes.length, 0);
  assert.equal(unchanged.changes.some((change) => change.row === PROTECTED_ROW || change.id === PROTECTED_SITE_ID), false);

  const edited = planSiteMirror([pipeline], [
    { site_id: "PIPE-PHX-0001", cells: { ...raw, "Next step": "A new raw next step." } },
    { site_id: "PIPE-MIA-0099", cells: { Name: "Missing" } },
  ]);
  assert.deepEqual(edited.changes.map((change) => change.header), ["Next step"]);
  assert.equal(edited.changes[0]?.column, 6);
  assert.equal(edited.changes[0]?.after, "A new raw next step.");
  assert.equal(edited.changes.some((change) => change.header === "Stage" || change.header === "Folder"), false);
  assert.deepEqual(edited.unmatched, ["PIPE-MIA-0099"]);
});

test("agents write only their fields, and a new site needs a Phoenix, Las Vegas, or Miami market", () => {
  assert.throws(
    () => validateBatch(agent, "muse-photo", { changes: [siteChange({ photo_notes: "Frontage", photo_status: "Partial" }, 1)] }),
    /cannot write that field/,
  );
  assert.throws(
    () => validateBatch({ id: "indie", kind: "agent" }, "indie-note", { changes: [siteChange({ notes: "A public note" }, 1)] }),
    /cannot write that field/,
  );
  assert.throws(
    () => validateBatch(agent, "muse-edge", { changes: [siteChange({ service_area_class: "edge_legacy" }, 1)] }),
    /cannot set that service area/,
  );
  assert.throws(
    () => validateBatch(contributor, "new-sna", { changes: [siteChange({ name: "Newport", market: "SNA" })] }),
    /PHX, LAS, or MIA/,
  );
  assert.throws(
    () => validateBatch(contributor, "bad-source", { changes: [siteChange({ name: "Yard", market: "PHX", asking_price: 10, sources: { nickname: "desk" } })] }),
    /not for a numeric fact/,
  );
  assert.doesNotThrow(() =>
    validateBatch({ id: "indie", kind: "agent" }, "indie-photo", {
      changes: [siteChange({
        photo_status: "Partial",
        photo_refs: [{ role: "lot_aerial", source: "esri_world_imagery", view_url: "https://example.com/lot.jpg", visibility: "map" }],
      }, 1)],
    }),
  );
  assert.doesNotThrow(() =>
    validateBatch(agent, "muse-distance", {
      changes: [siteChange({ service_area_class: "inside", miles_to_depot: 3.2, sources: { miles_to_depot: "depot file" } }, 1)],
    }),
  );
});

type ScorePoints = { Inside: number; "Near 0-5": number; "Near 5-10": number; Outside: number };
