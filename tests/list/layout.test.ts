import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { memorySql } from "../helpers/sql";
import {
  allowedIds,
  cycleSort,
  defaultLayout,
  columnFloor,
  displayIds,
  fitColumnWidths,
  parkCounty,
  moveColumn,
  phoneColumns,
  prepareRows,
  sanitizeLayout,
  sortFromParam,
  TRAILING_COLUMN_WIDTH,
} from "../../lib/listLayout";
import { layoutStoreUnavailable } from "../../lib/api/handlers/list/layout";
import { loadListLayout, saveListLayout } from "../../lib/listLayoutStore";
import { isProtectedId, omitProtectedDeals, omitProtectedSites } from "../../lib/protectedSite";

const pipeline = ["site", "stage", "score", "asking", "openLand", "cashFlow", "nda", "lastContact", "nextStep"];

test("a signed-out sheet drops financials, NDA, contact, and next step", () => {
  const allowed = allowedIds(pipeline, false);
  assert.deepEqual(allowed, ["site", "stage", "score", "openLand"]);
  const layout = sanitizeLayout({ order: pipeline, hidden: [], pinned: ["asking"], filters: { asking: "secret" } }, allowed);
  assert.equal(layout.order.includes("asking"), false);
  assert.equal(layout.order.includes("nda"), false);
  assert.equal(layout.order.includes("lastContact"), false);
  assert.equal(layout.order.includes("nextStep"), false);
  assert.equal(layout.pinned.includes("asking"), false);
});

test("header sort switches direction and does not clear", () => {
  assert.deepEqual(cycleSort(null, "stage"), { id: "stage", desc: false });
  assert.deepEqual(cycleSort({ id: "stage", desc: false }, "stage"), { id: "stage", desc: true });
  assert.deepEqual(cycleSort({ id: "stage", desc: true }, "stage"), { id: "stage", desc: false });
  assert.deepEqual(cycleSort({ id: "stage", desc: false }, "score"), { id: "score", desc: false });
});

test("reorder, pin, and hide keep the site column and the saved order", () => {
  const layout = sanitizeLayout({
    order: moveColumn(pipeline, "score", "stage"),
    hidden: ["cashFlow", "site"],
    pinned: ["stage", "site"],
    touched: true,
    widths: { stage: 20, score: 900 },
  }, pipeline);
  assert.deepEqual(layout.order.slice(0, 3), ["site", "score", "stage"]);
  assert.equal(layout.hidden.includes("site"), false);
  assert.equal(layout.hidden.includes("cashFlow"), true);
  assert.equal(layout.widths.stage, columnFloor("stage"));
  assert.equal(layout.widths.score, 480);
  const shown = displayIds(layout, allowedIds(pipeline, true), false, phoneColumns("pipeline"));
  assert.equal(shown[0], "stage");
  assert.equal(shown[1], "site");
  assert.equal(shown.includes("cashFlow"), false);
});

test("an untouched phone sheet uses the short column set", () => {
  const layout = defaultLayout(pipeline);
  const shown = displayIds(layout, pipeline, true, phoneColumns("pipeline"));
  assert.deepEqual(shown, ["site", "stage", "asking", "cashFlow"]);
});

test("column filters and numeric sort leave text facts as text", () => {
  const rows = [
    { id: "SITE-A", name: "North lot", stage: "Desk", acres: "not a number", score: 2 },
    { id: "SITE-B", name: "South lot", stage: "Land", acres: "12", score: null },
    { id: "SITE-C", name: "East lot", stage: "Desk", acres: "3", score: 9 },
  ];
  const columns = [
    { id: "site", label: "Site", text: (row: typeof rows[number]) => row.name },
    { id: "stage", label: "Stage", text: (row: typeof rows[number]) => row.stage },
    {
      id: "score",
      label: "Score",
      text: (row: typeof rows[number]) => (row.score == null ? "" : String(row.score)),
      sortValue: (row: typeof rows[number]) => row.score,
    },
    { id: "acres", label: "Acres", text: (row: typeof rows[number]) => row.acres },
  ];
  const layout = {
    ...defaultLayout(["site", "stage", "score", "acres"]),
    filters: { stage: "desk" },
    sort: { id: "score", desc: true },
    touched: true,
  };
  const shown = prepareRows(rows, columns, layout, ["site", "stage", "score", "acres"]);
  assert.deepEqual(shown.map((row) => row.id), ["SITE-C", "SITE-A"]);
  const textSort = prepareRows(rows, columns, { ...layout, filters: {}, sort: { id: "acres", desc: false } }, ["acres"]);
  assert.deepEqual(textSort.map((row) => row.acres), ["3", "12", "not a number"]);
  assert.equal(sortFromParam("none", ["site"]), null);
  assert.equal(sortFromParam(null, ["site"]), undefined);
});

const pipelineIds = ["site", "stage", "score", "asking", "openLand", "capacity", "traffic", "cashFlow"];

test("county check sits beside stage when a saved order left it at the end", () => {
  assert.deepEqual(
    parkCounty(["site", "stage", "score", "asking", "chip_environmental", "county"]),
    ["site", "stage", "county", "score", "asking", "chip_environmental"],
  );
  const layout = sanitizeLayout(
    { order: ["site", "stage", "score", "asking", "chip_environmental", "county"], touched: true },
    ["site", "stage", "county", "score", "asking", "chip_environmental"],
  );
  assert.deepEqual(layout.order, ["site", "stage", "county", "score", "asking", "chip_environmental"]);
});

test("a narrow pane scrolls instead of shrinking a column below its header", () => {
  const ids = ["site", "stage", "county", "score", "spare", "grade", "traffic", "listed"];
  const widePane = fitColumnWidths(ids, {}, 1920, TRAILING_COLUMN_WIDTH);
  for (const pane of [1024, 1280, 1440]) {
    const fitted = fitColumnWidths(ids, {}, pane, TRAILING_COLUMN_WIDTH);
    assert.deepEqual(fitted, widePane);
    ids.forEach((id, index) => assert.ok(fitted[index] >= columnFloor(id), id));
  }
  assert.ok(widePane.reduce((sum, width) => sum + width, 0) + TRAILING_COLUMN_WIDTH > 1280);
  assert.equal(columnFloor("openLand"), 144);
  assert.equal(columnFloor("grade"), 130);
  assert.equal(columnFloor("traffic"), 120);
  assert.equal(columnFloor("chip_advance"), 184);
  const pipeline = ["site", "stage", "county", "score", "asking", "openLand", "capacity", "traffic", "cashFlow"];
  const narrow = fitColumnWidths(pipeline, {}, 1280, TRAILING_COLUMN_WIDTH);
  assert.equal(narrow[pipeline.indexOf("county")], columnFloor("county"));
  assert.ok(narrow.reduce((sum, width) => sum + width, 0) + TRAILING_COLUMN_WIDTH > 1280);
  const crushed = fitColumnWidths(pipeline, {
    site: 200,
    asking: 70,
    openLand: 40,
    capacity: 40,
    traffic: 50,
    cashFlow: 50,
  }, 1280, TRAILING_COLUMN_WIDTH);
  pipeline.forEach((id, index) => assert.ok(crushed[index] >= columnFloor(id), id));
  const wide = fitColumnWidths(pipeline, { site: 420, cashFlow: 400 }, 1920, TRAILING_COLUMN_WIDTH);
  assert.equal(wide[0], 420);
  assert.equal(wide[pipeline.indexOf("cashFlow")], 400);
  assert.equal(wide[pipeline.indexOf("asking")], columnFloor("asking"));
  const loaded = sanitizeLayout({ widths: { site: 48, stage: 90 }, order: ["site", "stage"], touched: true, pinned: ["stage"] }, ["site", "stage", "chip_waiting"]);
  assert.ok((loaded.widths.site || 0) >= columnFloor("site"));
  assert.equal(loaded.pinned[0], "site");
});

test("a closed preview layout read stays on the browser layout", async () => {
  const saved = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "preview";
  delete process.env.PREVIEW_DATABASE_BRANCH;
  try {
    const { GET, PUT } = await import("../../lib/api/handlers/list/layout");
    const read = await GET(new Request("http://localhost/api/list/layout?surface=pipeline"));
    assert.equal(read.status, 200);
    assert.deepEqual(await read.json(), { layout: null, stored: false });
    const write = await PUT(new Request("http://localhost/api/list/layout", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ surface: "pipeline", layout: { order: ["site"], touched: true } }),
    }));
    assert.equal(write.status, 200);
    const body = (await write.json()) as { stored: boolean };
    assert.equal(body.stored, false);
  } finally {
    if (saved === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = saved;
  }
});

test("a preview keeps the sheet when the layout table cannot be read", () => {
  const missing = Object.assign(new Error("relation"), { code: "42P01" });
  assert.equal(layoutStoreUnavailable(missing), true);
  const aborted = Object.assign(new Error("aborted"), { code: "25P02" });
  assert.equal(layoutStoreUnavailable(aborted), true);
  const previous = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "preview";
  try {
    assert.equal(layoutStoreUnavailable(new Error("connection")), true);
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous;
  }
  assert.equal(layoutStoreUnavailable(new Error("connection")), false);
});

test("list layouts are stored per user and ignored until the table exists", async () => {
  const sql = await memorySql();
  const allowed = ["site", "stage"];
  const one = sanitizeLayout({ order: ["stage", "site"], pinned: ["site"], touched: true, sort: { id: "stage", desc: true } }, allowed);
  const two = sanitizeLayout({ order: ["site", "stage"], hidden: ["stage"], touched: true }, allowed);
  await assert.rejects(() => loadListLayout(sql, "ada", "pipeline", allowed));
  await sql.exec(readFileSync("db/migrations/013_list_layouts.sql", "utf8"));
  assert.deepEqual(await saveListLayout(sql, "ada", "pipeline", one, allowed), one);
  assert.deepEqual(await saveListLayout(sql, "beau", "pipeline", two, allowed), two);
  assert.deepEqual(await loadListLayout(sql, "ada", "pipeline", allowed), one);
  assert.equal((await loadListLayout(sql, "beau", "pipeline", allowed))?.hidden.includes("stage"), true);
  assert.equal(await loadListLayout(sql, "ada", "universe", allowed), null);
  assert.equal(isProtectedId("PIPE-PHX-0006"), true);
  assert.equal(omitProtectedDeals([{ properties: { deal_id: "PIPE-PHX-0006" } }, { properties: { deal_id: "SITE-A" } }]).length, 1);
  assert.equal(omitProtectedSites([
    { properties: { site_id: "PIPE-PHX-0006" } },
    { properties: { site_id: "SITE-B", linked_deal_id: "PIPE-PHX-0006" } },
    { properties: { site_id: "SITE-C" } },
  ]).length, 1);
});
