import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { applyBatch, VersionConflictError } from "../../lib/changes/apply";
import { importChanged } from "../../lib/changes/backfill";
import { buildReport, diffDatabase } from "../../lib/changes/diff";
import { importEntityFromWorkbook, readEntityFromDb } from "../../lib/changes/flags";
import { PROTECTED_ROW, PROTECTED_SITE_ID, planSiteMirror, sheetValueRender, type SheetTable } from "../../lib/changes/mirror";
import { applySiteRows } from "../../lib/changes/read";
import { validateBatch, type Actor } from "../../lib/changes/schema";
import { loadScorecard, recordedLocationPoints, recordedScore, scorecardTotal } from "../../lib/changes/scorecard";
import { displayNote, emptySiteFields, listingFlags, listingKnown, mirrorCellInput, mirrorHeaderAllowed, mirrorWrites, siteIssues, type SiteRow } from "../../lib/changes/site";
import { isSnapshotFile } from "../../lib/snapshot/hash";
import { readGenerated } from "../../lib/snapshot/read";
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
  const headers = ["Stage", "Folder", "Name", "Site ID", "Asking price ($)", "Next step", "Score (of 100)"];
  const pipeline = sheet(headers, [
    ["1 Desk screen", "https://drive.google.com/folder", "Sonoran Express", "PIPE-PHX-0001", "$1,600,000", "Confirm the zoning.", "24"],
    ["Dropped", "secret", "Quarantine", PROTECTED_SITE_ID, "$1", "secret note", "1"],
  ]);
  pipeline.rows[0].formulas = ["", "", "", "", "", "", "=SUM(A1)"];
  pipeline.rows[1].row = PROTECTED_ROW;
  const unchanged = planSiteMirror(
    [pipeline, { title: "Land Sites", headerRow: 4, headers, rows: [] }],
    [
      { site_id: "PIPE-PHX-0001", cells: { Name: "Sonoran Express", "Asking price ($)": "1600000", "Score (of 100)": "23.73421741" } },
      { site_id: PROTECTED_SITE_ID, writes: { Name: "Do not write", "Next step": "secret" } },
    ],
  );
  assert.equal(unchanged.changes.length, 0);
  assert.equal(unchanged.changes.some((change) => change.row === PROTECTED_ROW || change.id === PROTECTED_SITE_ID), false);

  const edited = planSiteMirror([pipeline], [
    { site_id: "PIPE-PHX-0001", writes: { "Next step": "Confirm the lot size.", "Score (of 100)": "23.73421741", Name: "Renamed" } },
    { site_id: "PIPE-MIA-0099", writes: { Name: "Missing" } },
  ]);
  assert.deepEqual(edited.changes.map((change) => change.header), ["Next step"]);
  assert.equal(edited.changes[0]?.column, 6);
  assert.equal(edited.changes[0]?.after, "Confirm the lot size.");
  assert.equal(edited.changes.some((change) => change.header === "Stage" || change.header === "Folder" || change.header === "Score (of 100)" || change.header === "Name"), false);
  assert.deepEqual(edited.unmatched, ["PIPE-MIA-0099"]);
});

test("a fresh import over formatted currency, percents, dates, and formulas plans no writes", () => {
  assert.equal(sheetValueRender("unformatted"), "UNFORMATTED_VALUE");
  assert.equal(sheetValueRender("formatted"), null);
  assert.equal(sheetValueRender("formulas"), "FORMULA");
  assert.equal(mirrorCellInput("Asking price ($)"), "USER_ENTERED");
  assert.equal(mirrorCellInput("Next step"), "RAW");
  assert.equal(mirrorCellInput("Stage"), "RAW");
  const headers = ["Site ID", "Asking price ($)", "Location points", "Score (of 100)", "Spare area (sq ft)", "Population growth (3-mile)", "Land (acres)", "Photos checked", "Stalls that fit"];
  const table = sheet(headers, [["PIPE-PHX-0001", "$1,600,000", "10.0", "24", "4,000", "-5.57%", "1.20", "Oct 28", "12"]]);
  table.rows[0].formulas = ["", "", "", "=SUM(A1)", "", "", "", "", "=B1"];
  const imported = {
    site_id: "PIPE-PHX-0001",
    cells: {
      "Asking price ($)": "1600000",
      "Location points": "10",
      "Score (of 100)": "23.73421741",
      "Spare area (sq ft)": "4000",
      "Population growth (3-mile)": "-0.0557",
      "Land (acres)": "1.2",
      "Photos checked": "2026-10-28",
      "Stalls that fit": "12",
    },
  };
  assert.equal(planSiteMirror([table], [imported]).changes.length, 0);
  const same = planSiteMirror([table], [{ site_id: "PIPE-PHX-0001", writes: imported.cells }]);
  assert.equal(same.changes.length, 0);
  const changed = planSiteMirror([table], [{ site_id: "PIPE-PHX-0001", writes: { "Asking price ($)": "1700000", "Stalls that fit": "8" } }]);
  assert.deepEqual(changed.changes.map((change) => change.header), ["Asking price ($)"]);
  assert.equal(changed.changes[0]?.after, "1700000");
  assert.equal(changed.changes[0]?.valueInput, "USER_ENTERED");
});

test("the public next step drops outreach, names, and package text", () => {
  const card = JSON.parse(readFileSync("data/fixtures/public-next-step.json", "utf8")) as { signed_in_next_step: string; public_next_step: string };
  assert.equal(displayNote(card.signed_in_next_step), card.public_next_step);
  const kept = displayNote("Confirm the zoning. Package status stays Received. The land check is not finished.");
  assert.match(kept, /Confirm the zoning/);
  assert.match(kept, /The land check is not finished/);
  assert.doesNotMatch(kept, /Package/);
  assert.equal(displayNote("Confirm the title report."), "");
  assert.equal(displayNote("Street view and the Dec 2025 deed to confirm the use; then owner outreach once Cindel approves the wording"), "Confirm use from street view and the deed.");
});

test("the raw site sheet is not a snapshot file and is not served", () => {
  assert.match(execFileSync("git", ["check-ignore", "-v", "data/generated/site_sheet.json"], { encoding: "utf8" }), /site_sheet\.json/);
  assert.equal(execFileSync("git", ["ls-files", "--", "data/generated/site_sheet.json"], { encoding: "utf8" }).trim(), "");
  assert.equal(isSnapshotFile("site_sheet.json"), false);
  assert.equal(isSnapshotFile("deals.geojson"), true);
  assert.throws(() => readGenerated("site_sheet.json"), /not a public snapshot file/);
  assert.equal(mirrorHeaderAllowed("Folder"), false);
  assert.equal(mirrorHeaderAllowed("Broker"), true);
  assert.equal(mirrorHeaderAllowed("Score (of 100)"), false);
  assert.equal(mirrorHeaderAllowed("Stalls that fit"), false);
  const writes = mirrorWrites(
    { county_value: "2236814", service_area_class: "inside", broker: "Ada Broker", miles_to_depot: "3.2" },
    { cap_a_substation_mi: "1.5", land_acres_basis: "Estimated" },
  );
  assert.equal(writes["County value ($)"], "2236814");
  assert.equal(writes["Inside the service area"], "Inside");
  assert.equal(writes["pwr_a_substation_mi"], "1.5");
  assert.equal(writes["Land basis"], "Estimated");
  assert.equal(writes.Broker, "Ada Broker");
  assert.equal(writes.Firm, undefined);
  assert.equal("miles_to_depot" in writes, false);
  const hold = "On hold - broker Nov 6: waiting on the survey";
  assert.equal(listingKnown(hold), true);
  assert.deepEqual(listingFlags(hold), { listed: false, removed: false });
  const held = siteIssues([{ ...emptySiteFields(), site_id: "PIPE-MIA-0082", coord_status: "", sheet: "{}", facts: {}, market: "MIA", listing_status: hold, photo_refs: "[]" }]);
  assert.equal(held.some((issue) => issue.field === "listing_status"), false);
});

test("a site diff without the private sheet ignores raw-cell fields", () => {
  const base = { ...emptySiteFields(), coord_status: "listing", facts: {}, photo_refs: "[]", market: "MIA", name: "Stars" };
  const published: SiteRow = { ...base, site_id: "PIPE-MIA-0082", sheet: "{}", notes: "Confirm the zoning.", address: "1 Main", listing_status: "", listing_url: "https://example.test/listing" };
  const stored: SiteRow = {
    ...published,
    notes: "On hold - broker Nov 6: the package is in the folder.",
    address: "MIA 1 Main St",
    listing_status: "On hold - broker Nov 6: waiting on the survey",
    listing_url: "https://example.test/listing?raw=1",
    sheet: JSON.stringify({ "Next step": "On hold - broker Nov 6: the package is in the folder." }),
  };
  const empty = { stages: [], activities: [], comms: [] };
  const skipped = buildReport({ ...empty, sites: [published] }, { ...empty, sites: [stored] }, "published deals");
  assert.equal(skipped.entities.site.changed.length, 0);
  assert.equal(skipped.entities.site.missing.length, 0);
  const raw: SiteRow = { ...published, sheet: JSON.stringify({ "Next step": "Confirm the zoning." }) };
  const seen = buildReport({ ...empty, sites: [raw] }, { ...empty, sites: [stored] }, "private sheet");
  assert.equal(seen.entities.site.changed.some((change) => change.field === "notes"), true);
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
