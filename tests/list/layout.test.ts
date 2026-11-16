import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { memorySql } from "../helpers/sql";
import {
  allowedIds,
  columnWidth,
  cycleSort,
  defaultLayout,
  displayIds,
  fitColumnWidths,
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

test("header sort cycles ascending, descending, then none", () => {
  assert.deepEqual(cycleSort(null, "stage"), { id: "stage", desc: false });
  assert.deepEqual(cycleSort({ id: "stage", desc: false }, "stage"), { id: "stage", desc: true });
  assert.equal(cycleSort({ id: "stage", desc: true }, "stage"), null);
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
  assert.equal(layout.widths.stage, 96);
  assert.equal(layout.widths.score, 480);
  const shown = displayIds(layout, allowedIds(pipeline, true), false, phoneColumns("pipeline"));
  assert.equal(shown[0], "stage");
  assert.equal(shown[1], "site");
  assert.equal(shown.includes("cashFlow"), false);
});

test("an untouched phone sheet uses the short column set", () => {
  const layout = defaultLayout(pipeline);
  const shown = displayIds(layout, pipeline, true, phoneColumns("pipeline"));
  assert.deepEqual(shown, ["site", "stage", "score", "openLand"]);
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
const flexIds = new Set(["site", "asking", "listed", "capacity", "grade", "traffic", "cashFlow"]);

test("a default sheet uses the pane and keeps rigid columns", () => {
  for (const pane of [1280, 1440, 1920]) {
    const fitted = fitColumnWidths(pipelineIds, {}, pane, TRAILING_COLUMN_WIDTH, flexIds);
    assert.equal(fitted.reduce((sum, width) => sum + width, 0) + TRAILING_COLUMN_WIDTH, pane);
    assert.equal(fitted[1], columnWidth("stage"));
    assert.equal(fitted[2], columnWidth("score"));
    assert.equal(fitted[4], columnWidth("openLand"));
    assert.ok(fitted.every((width) => width >= 96));
  }
  const wide = fitColumnWidths(pipelineIds, {}, 1920, TRAILING_COLUMN_WIDTH, flexIds);
  assert.ok(wide[0] > columnWidth("site"));
  assert.ok(wide[3] > columnWidth("asking"));
  assert.ok(wide[5] > columnWidth("capacity"));
  assert.ok(wide[6] > columnWidth("traffic"));
  assert.ok(wide[7] > columnWidth("cashFlow"));
  const narrow = fitColumnWidths(pipelineIds, {}, 1280, TRAILING_COLUMN_WIDTH, flexIds);
  assert.ok(narrow[0] < columnWidth("site"));
  assert.ok(narrow[0] >= 280);
  const withWaiting = fitColumnWidths(["site", "chip_waiting", ...pipelineIds.slice(1)], {}, 1024, TRAILING_COLUMN_WIDTH, flexIds);
  assert.ok(withWaiting[0] >= 280);
  const savedNarrow = fitColumnWidths(
    ["site", "chip_waiting", "stage", "score", "asking", "openLand", "capacity", "traffic", "cashFlow"],
    { site: 48, stage: 140, score: 96, asking: 160, openLand: 110, capacity: 120, traffic: 100, cashFlow: 140 },
    1024,
    TRAILING_COLUMN_WIDTH,
    flexIds,
  );
  assert.ok(savedNarrow[0] >= 280);
  const loaded = sanitizeLayout({ widths: { site: 48, stage: 90 }, order: ["site", "stage"], touched: true }, ["site", "stage", "chip_waiting"]);
  assert.ok((loaded.widths.site || 0) >= 280);
});

test("a saved layout keeps its widths and the last flexible column fills a wider pane", () => {
  const widths = {
    site: 300,
    stage: 140,
    score: 100,
    asking: 150,
    openLand: 110,
    capacity: 130,
    traffic: 100,
    cashFlow: 140,
  };
  const fitted = fitColumnWidths(pipelineIds, widths, 1600, TRAILING_COLUMN_WIDTH, flexIds);
  assert.equal(fitted[0], 300);
  assert.equal(fitted[1], 140);
  assert.equal(fitted[3], 150);
  assert.equal(fitted[5], 130);
  assert.equal(fitted[6], 100);
  assert.ok(fitted[7] > 140);
  assert.equal(fitted.reduce((sum, width) => sum + width, 0) + TRAILING_COLUMN_WIDTH, 1600);
  const askingLast = fitColumnWidths(["site", "cashFlow", "asking"], { site: 300, cashFlow: 120, asking: 140 }, 900, 0, flexIds);
  assert.deepEqual(askingLast, [300, 120, 480]);
  const wider = fitColumnWidths(pipelineIds, { ...widths, site: 420, asking: 400, capacity: 400, traffic: 300, cashFlow: 400 }, 1280, TRAILING_COLUMN_WIDTH, flexIds);
  assert.equal(wider[0], 420);
  assert.equal(wider[7], 400);
  assert.ok(wider.reduce((sum, width) => sum + width, 0) + TRAILING_COLUMN_WIDTH > 1280);
  assert.deepEqual(fitColumnWidths(pipelineIds, {}, 0, TRAILING_COLUMN_WIDTH, flexIds), pipelineIds.map((id) => columnWidth(id)));
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
