import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { InputError } from "../../lib/actions/text";
import { applyBatch } from "../../lib/changes/apply";
import { loadMirrorRows, mirrorGridNeedsGrowth, mirrorGridRequests, planCreatedSiteMirror, planSiteMirror, sheetsFailureMessage, type SheetTable } from "../../lib/changes/mirror";
import { validateBatch, type Actor, type SitePayload } from "../../lib/changes/schema";
import { MIRROR_FIELD_HEADERS } from "../../lib/changes/site";
import { readConflict } from "../../lib/conflicts/record";
import { memorySql } from "../helpers/sql";

const muse: Actor = { id: "muse", kind: "agent" };
const indie: Actor = { id: "indie", kind: "agent" };
const human: Actor = { id: "ada", kind: "human", role: "contributor" };
const FOLDER = "https://drive.google.com/drive/folders/SampleFolderId01";

function siteChange(payload: Record<string, unknown>, expected = 1, siteId = "PIPE-PHX-9101") {
  return {
    entity_type: "site",
    site_id: siteId,
    expected_version: expected,
    source: "Sample listing",
    payload,
  };
}

function fieldsOf(actor: Actor, key: string, payload: Record<string, unknown>, expected = 1): SitePayload {
  const batch = validateBatch(actor, key, { changes: [siteChange(payload, expected)] });
  const parsed = batch.changes[0]?.payload;
  assert.ok(parsed && "fields" in parsed);
  return parsed;
}

test("Indie can set a Drive folder and identity fields, and Muse cannot", () => {
  const folder = fieldsOf(indie, "indie-folder", { folder_url: FOLDER });
  assert.equal(folder.facts.folder_url, FOLDER);
  assert.throws(
    () => fieldsOf(indie, "indie-folder-bad", { folder_url: "https://example.com/folder" }),
    (error: unknown) => error instanceof InputError && error.field === "folder_url",
  );
  assert.throws(() => fieldsOf(muse, "muse-folder", { folder_url: FOLDER }), /cannot write that field/);

  const identity = fieldsOf(indie, "indie-address", {
    address: "100 Placeholder Lane",
    apn: "000-00-001",
    lat: 33.4,
    lng: -112.1,
    sources: { address: "Sample map", apn: "Sample map", lat: "Sample map", lng: "Sample map" },
  });
  assert.equal(identity.fields.address, "100 Placeholder Lane");
  assert.equal(identity.fields.apn, "000-00-001");
  assert.equal(identity.sources.address, "Sample map");
  assert.throws(
    () => fieldsOf(indie, "indie-address-bare", { address: "200 Placeholder Lane" }),
    /address needs a source/,
  );
  assert.throws(
    () => fieldsOf(muse, "muse-address", { address: "200 Placeholder Lane", sources: { address: "Sample map" } }),
    /cannot write that field/,
  );
  assert.doesNotThrow(() =>
    fieldsOf(human, "human-address", { address: "300 Placeholder Lane" }),
  );
});

test("a top-level spare area is stored as a fact, and an unknown key is rejected", () => {
  const top = fieldsOf(muse, "top-spare", {
    open_land_sqft: 1200,
    open_land_basis: "Sample aerial",
    sources: { open_land_sqft: "Sample aerial" },
  });
  assert.equal(top.facts.open_land_sqft, "1200");
  assert.equal(top.facts.open_land_basis, "Sample aerial");
  const nested = fieldsOf(muse, "nested-spare", {
    facts: { open_land_sqft: 800 },
    sources: { open_land_sqft: "Sample aerial" },
  });
  assert.equal(nested.facts.open_land_sqft, "800");
  assert.throws(
    () => fieldsOf(muse, "unknown-key", { nickname: "nope" }),
    /That field is not accepted/,
  );
});

test("Indie overriding a stored address records both values and both sources", async () => {
  const sql = await memorySql();
  await migrate(sql);
  await applyBatch(sql, human, "seed-address", {
    changes: [siteChange({
      name: "Sample lube",
      market: "PHX",
      address: "100 Placeholder Lane",
    }, 0)],
  });
  await applyBatch(sql, indie, "override-address", {
    changes: [siteChange({
      address: "200 Placeholder Lane",
      sources: { address: "Sample map" },
    }, 1)],
  });
  const rows = await sql.query<{ subject: string; source_a_value: string; source_b_value: string; source_a_document: string; source_b_document: string; value_in_use: string }>(
    `SELECT subject, source_a_value, source_b_value, source_a_document, source_b_document, value_in_use FROM data_conflicts`,
  );
  assert.equal(rows.rows.length, 1);
  const row = rows.rows[0];
  assert.equal(row?.subject, "address");
  assert.equal(row?.source_a_value, "100 Placeholder Lane");
  assert.equal(row?.source_b_value, "200 Placeholder Lane");
  assert.equal(row?.source_a_document, "on file");
  assert.equal(row?.source_b_document, "Sample map");
  assert.equal(row?.value_in_use, "200 Placeholder Lane");
  const stored = await readConflict(sql, (await sql.query<{ entity_id: string }>(`SELECT entity_id FROM data_conflicts`)).rows[0]!.entity_id);
  assert.equal(stored?.field, "address");
});

test("Land Sites growth is planned when a write passes the last row", () => {
  const column = 89;
  const change = {
    sheet: "Land Sites",
    row: 178,
    column,
    header: "Folder",
    id: "LAND-PHX-9101",
    before: "",
    after: FOLDER,
    valueInput: "RAW" as const,
  };
  const grid = { sheetId: 42, columnCount: 80, rowCount: 162 };
  assert.equal(mirrorGridNeedsGrowth([change], grid), true);
  const body = mirrorGridRequests([change], grid);
  const appends = body.requests.filter((request) => "appendDimension" in request);
  assert.deepEqual(
    appends.map((request) => request.appendDimension),
    [
      { sheetId: 42, dimension: "COLUMNS", length: column - 80 },
      { sheetId: 42, dimension: "ROWS", length: 178 - 162 },
    ],
  );
  assert.ok(body.requests.findIndex((request) => "appendDimension" in request) < body.requests.findIndex((request) => "updateCells" in request));
});

test("Folder, Segment, and Trade-area checked copy only a non-empty difference", () => {
  assert.equal(MIRROR_FIELD_HEADERS.some((row) => row.headers.includes("Folder") && row.field === "folder_url"), true);
  assert.equal(MIRROR_FIELD_HEADERS.some((row) => row.headers.includes("Segment") && row.field === "category"), true);
  assert.equal(MIRROR_FIELD_HEADERS.some((row) => row.headers.includes("Trade-area checked")), true);
  const table: SheetTable = {
    title: "Pipeline",
    headerRow: 4,
    headers: ["site id", "Segment", "Folder", "Trade-area checked"],
    rows: [
      { row: 5, cells: ["PIPE-PHX-9101", "Car wash", "", ""] },
      { row: 6, cells: ["PIPE-PHX-9102", "Quick lube", FOLDER, "Yes"], formulas: ["", "=A1", "", ""] },
    ],
  };
  const plan = planSiteMirror([table], [
    { site_id: "PIPE-PHX-9101", writes: { Segment: "Quick lube", Folder: FOLDER, "Trade-area checked": "Yes" } },
    { site_id: "PIPE-PHX-9102", writes: { Segment: "Car wash", Folder: "", "Trade-area checked": "Yes" } },
  ]);
  assert.deepEqual(
    plan.changes.map((change) => ({ row: change.row, header: change.header, after: change.after })),
    [
      { row: 5, header: "Segment", after: "Quick lube" },
      { row: 5, header: "Folder", after: FOLDER },
      { row: 5, header: "Trade-area checked", after: "Yes" },
    ],
  );
  const created = planCreatedSiteMirror([{
    title: "Pipeline",
    headerRow: 4,
    headers: ["site id", "stage", "Segment", "Folder"],
    rows: [],
  }], [{
    site_id: "PIPE-PHX-9103",
    kind: "pipeline",
    values: { stage: "1 Desk screen", name: "Sample lube", category: "Quick lube", folder_url: "", id: "PIPE-PHX-9103" },
  }]);
  assert.equal(created.changes.some((change) => change.header === "Segment" && change.after === "Quick lube"), true);
  assert.equal(created.changes.some((change) => change.header === "Folder"), false);
});

test("a stored APN copies onto an existing row only when it differs", async () => {
  assert.equal(MIRROR_FIELD_HEADERS.some((row) => row.field === "apn" && row.headers.includes("APN or folio") && row.headers.includes("APN")), true);
  const sql = await memorySql();
  await migrate(sql);
  await sql.query(`INSERT INTO sites (site_id, apn, version, updated_by) VALUES ('PIPE-PHX-9101', '000-00-086', 1, 'test'), ('PIPE-PHX-9102', '', 1, 'test')`);
  const rows = await loadMirrorRows(sql);
  const filled = rows.sites.find((row) => row.site_id === "PIPE-PHX-9101");
  const blank = rows.sites.find((row) => row.site_id === "PIPE-PHX-9102");
  assert.equal(filled?.writes["APN or folio"], "000-00-086");
  assert.equal(blank?.writes["APN or folio"], undefined);
  const table: SheetTable = {
    title: "Pipeline",
    headerRow: 4,
    headers: ["site id", "APN"],
    rows: [
      { row: 8, cells: ["PIPE-PHX-9101", ""] },
      { row: 9, cells: ["PIPE-PHX-9102", "000-00-087"], formulas: ["", "=B9"] },
    ],
  };
  const plan = planSiteMirror([table], [
    { site_id: "PIPE-PHX-9101", writes: { "APN or folio": "000-00-086" } },
    { site_id: "PIPE-PHX-9102", writes: { "APN or folio": "" } },
  ]);
  assert.deepEqual(plan.changes.map((change) => ({ row: change.row, header: change.header, after: change.after })), [
    { row: 8, header: "APN", after: "000-00-086" },
  ]);
  assert.throws(
    () => fieldsOf(muse, "muse-apn", { apn: "000-00-099", sources: { apn: "Sample map" } }),
    /cannot write that field/,
  );
});

test("Indie can write trade-area facts, and the road still needs a source", () => {
  const written = fieldsOf(indie, "indie-trade", {
    trade_aadt: 12000,
    trade_aadt_road: "Sample Road",
    trade_growth: 0.0119,
    sources: { trade_aadt: "Sample count", trade_aadt_road: "Sample map", trade_growth: "Sample count" },
  });
  assert.equal(written.facts.trade_aadt, "12000");
  assert.equal(written.facts.trade_aadt_road, "Sample Road");
  assert.equal(written.sources.trade_aadt_road, "Sample map");
  assert.equal(written.facts.trade_growth, "0.0119");
  assert.throws(
    () => fieldsOf(indie, "indie-road-bare", { trade_aadt_road: "Sample Road" }),
    /trade_aadt_road needs a source/,
  );
  assert.throws(
    () => fieldsOf(indie, "indie-trade-unknown", { trade_area_checked: "Yes" }),
    /That field is not accepted/,
  );
});

test("a source longer than 200 characters is rejected on its own", () => {
  assert.throws(
    () => fieldsOf(indie, "long-source", {
      trade_aadt: 12000,
      sources: { trade_aadt: "S".repeat(201) },
    }),
    /Source text is too long \(200 characters max\)/,
  );
});

test("a Sheets failure keeps the status and message and drops a token", () => {
  const message = sheetsFailureMessage(400, JSON.stringify({
    error: { status: "INVALID_ARGUMENT", message: "Range (Land Sites!CK178) exceeds grid limits. ya29.sample-token" },
  }));
  assert.match(message, /400/);
  assert.match(message, /INVALID_ARGUMENT/);
  assert.match(message, /exceeds grid limits/);
  assert.equal(message.includes("ya29"), false);
  assert.equal(message.includes("sample-token"), false);
});
