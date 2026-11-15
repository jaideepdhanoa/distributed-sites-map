import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { importChanged } from "../../lib/changes/backfill";
import {
  PROTECTED_ROW,
  PROTECTED_SITE_ID,
  a1,
  assertPlannedWrites,
  assertReadBack,
  assertWorkbookMirrorAllowed,
  entitiesToMirror,
  planActivityMirror,
  planCommsMirror,
  planStageMirror,
  type SheetTable,
} from "../../lib/changes/mirror";
import { memorySql } from "../helpers/sql";

function table(title: string, headerRow: number, headers: string[], body: string[][]): SheetTable {
  return {
    title,
    headerRow,
    headers,
    rows: body.map((cells, index) => ({ row: headerRow + 1 + index, cells })),
  };
}

test("stage writes use the Stage header and skip row 10 and PIPE-PHX-0006", () => {
  const headers = ["Notes", "Site ID", "Asking price", "Stage", "Broker"];
  const pipeline = table("Pipeline", 4, headers, [
    ["keep", "PIPE-PHX-0001", "$1", "1 Desk screen", "Pencek"],
    ["secret", PROTECTED_SITE_ID, "$9", "Dropped", "Nope"],
    ["other", "PIPE-PHX-0002", "$2", "1 Desk screen", "Ada"],
  ]);
  pipeline.rows[1].row = PROTECTED_ROW;
  const plan = planStageMirror([pipeline, table("Land Sites", 4, headers, [])], [
    { site_id: "PIPE-PHX-0001", stage: "2 Financial screen" },
    { site_id: PROTECTED_SITE_ID, stage: "1 Desk screen" },
    { site_id: "PIPE-PHX-0002", stage: "1 Desk screen" },
    { site_id: "PIPE-MIA-0099", stage: "Dropped" },
  ]);
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0]?.header, "Stage");
  assert.equal(plan.changes[0]?.column, 4);
  assert.equal(plan.changes[0]?.row, 5);
  assert.equal(plan.changes[0]?.id, "PIPE-PHX-0001");
  assert.equal(plan.changes[0]?.after, "2 Financial screen");
  assert.equal(plan.changes.some((change) => change.header !== "Stage"), false);
  assert.equal(plan.changes.some((change) => change.row === PROTECTED_ROW || change.id === PROTECTED_SITE_ID), false);
  assert.deepEqual(plan.unmatched, ["PIPE-MIA-0099"]);
  assert.equal(a1("Land Sites", 10, 4), "'Land Sites'!D10");

  const occupied = table("Pipeline", 4, headers, [["keep", "PIPE-PHX-0003", "$3", "1 Desk screen", "Ada"]]);
  occupied.rows[0].row = PROTECTED_ROW;
  const blocked = planStageMirror([occupied], [{ site_id: "PIPE-PHX-0003", stage: "Dropped" }]);
  assert.equal(blocked.changes.length, 0);
  assert.equal(blocked.skippedProtected, 1);
});

test("new activity and comms rows follow the live headers", () => {
  const activity = planActivityMirror(
    table("Activity", 1, ["Summary", "Event ID", "Date", "Site ID", "Type"], [["Listing noted", "A-000001", "2026-11-01", "PIPE-PHX-0001", "listing"]]),
    [
      { entity_id: "A-000001", site_id: "PIPE-PHX-0001", date: "2026-11-01", type: "listing", summary: "Listing noted", source_link: "" },
      { entity_id: "A-000272", site_id: "PIPE-PHX-0001", date: "2026-11-15", type: "visit", summary: "Visited", source_link: "" },
    ],
  );
  assert.deepEqual(
    activity.changes.map((change) => change.header),
    ["Event ID", "Date", "Site ID", "Type", "Summary"],
  );
  assert.equal(activity.changes[0]?.column, 2);
  assert.equal(activity.appended, 1);
  assert.equal(activity.changes.some((change) => change.column === 1 && change.header !== "Summary"), false);

  const onRowTen = table("Activity", 1, ["Event ID", "Summary"], []);
  onRowTen.rows.push({ row: 9, cells: ["A-000001", "old"] });
  const appended = planActivityMirror(onRowTen, [
    { entity_id: "A-000001", site_id: "PIPE-PHX-0001", date: "2026-11-01", type: "listing", summary: "Updated", source_link: "" },
    { entity_id: "A-000010", site_id: "PIPE-PHX-0001", date: "2026-11-15", type: "visit", summary: "Visited", source_link: "" },
  ]);
  assert.equal(appended.changes.some((change) => change.id === "A-000001" && change.row === 9), true);
  assert.equal(appended.changes.some((change) => change.id === "A-000010" && change.row === PROTECTED_ROW), true);

  const comms = planCommsMirror(
    table("Comms Log", 1, ["Summary", "Comms ID", "Direction", "Site IDs"], []),
    [{ entity_id: "CM-0500", values: { summary: "Called", direction: "out", site_ids: "PIPE-PHX-0001" } }],
  );
  assert.deepEqual(
    comms.changes.map((change) => [change.header, change.after]),
    [
      ["Comms ID", "CM-0500"],
      ["Site IDs", "PIPE-PHX-0001"],
      ["Direction", "out"],
      ["Summary", "Called"],
    ],
  );
});

test("a read-back mismatch fails", () => {
  const change = {
    sheet: "Pipeline",
    row: 5,
    column: 4,
    header: "Stage",
    id: "PIPE-PHX-0001",
    before: "1 Desk screen",
    after: "2 Financial screen",
  };
  assert.throws(
    () => assertReadBack([change], [{ sheet: "Pipeline", row: 5, column: 4, value: "1 Desk screen" }]),
    /Read-back mismatch/,
  );
  assert.doesNotThrow(() =>
    assertReadBack([change], [{ sheet: "Pipeline", row: 5, column: 4, value: "2 Financial screen" }]),
  );
  assert.throws(() => assertPlannedWrites([{ ...change, row: PROTECTED_ROW }]), /row 10/);
  assert.throws(() => assertPlannedWrites([{ ...change, id: PROTECTED_SITE_ID }]), /PIPE-PHX-0006/);
});

test("a dry run does not need WORKBOOK_MIRROR_ENABLED", () => {
  const saved = {
    vercel: process.env.VERCEL_ENV,
    event: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
    actions: process.env.GITHUB_ACTIONS,
    enabled: process.env.WORKBOOK_MIRROR_ENABLED,
    dry: process.env.WORKBOOK_MIRROR_DRY_RUN,
  };
  const restore = () => {
    const names = {
      vercel: "VERCEL_ENV",
      event: "GITHUB_EVENT_NAME",
      ref: "GITHUB_REF",
      actions: "GITHUB_ACTIONS",
      enabled: "WORKBOOK_MIRROR_ENABLED",
      dry: "WORKBOOK_MIRROR_DRY_RUN",
    } as const;
    for (const [key, name] of Object.entries(names)) {
      const value = saved[key as keyof typeof saved];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  try {
    delete process.env.VERCEL_ENV;
    delete process.env.GITHUB_EVENT_NAME;
    delete process.env.GITHUB_REF;
    delete process.env.GITHUB_ACTIONS;
    delete process.env.WORKBOOK_MIRROR_ENABLED;
    process.env.WORKBOOK_MIRROR_DRY_RUN = "1";
    assert.doesNotThrow(() => assertWorkbookMirrorAllowed());
    process.env.GITHUB_ACTIONS = "true";
    process.env.GITHUB_REF = "refs/heads/feature";
    assert.throws(() => assertWorkbookMirrorAllowed(), /only on main/);
    process.env.GITHUB_REF = "refs/heads/main";
    process.env.GITHUB_EVENT_NAME = "pull_request";
    assert.throws(() => assertWorkbookMirrorAllowed(), /pull request/);
    delete process.env.GITHUB_EVENT_NAME;
    process.env.VERCEL_ENV = "preview";
    assert.throws(() => assertWorkbookMirrorAllowed(), /from Vercel/);
  } finally {
    restore();
  }
});

test("the mirror refuses a preview, a pull request, and a disabled flag", () => {
  const saved = {
    vercel: process.env.VERCEL_ENV,
    event: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
    actions: process.env.GITHUB_ACTIONS,
    enabled: process.env.WORKBOOK_MIRROR_ENABLED,
    dry: process.env.WORKBOOK_MIRROR_DRY_RUN,
  };
  try {
    delete process.env.VERCEL_ENV;
    delete process.env.GITHUB_EVENT_NAME;
    delete process.env.GITHUB_REF;
    delete process.env.GITHUB_ACTIONS;
    delete process.env.WORKBOOK_MIRROR_ENABLED;
    delete process.env.WORKBOOK_MIRROR_DRY_RUN;
    assert.throws(() => assertWorkbookMirrorAllowed(), /WORKBOOK_MIRROR_ENABLED/);
    process.env.WORKBOOK_MIRROR_ENABLED = "1";
    process.env.GITHUB_ACTIONS = "true";
    process.env.GITHUB_REF = "refs/pull/95/merge";
    assert.throws(() => assertWorkbookMirrorAllowed(), /only on main/);
    process.env.GITHUB_REF = "refs/heads/main";
    process.env.GITHUB_EVENT_NAME = "pull_request";
    assert.throws(() => assertWorkbookMirrorAllowed(), /pull request/);
    delete process.env.GITHUB_EVENT_NAME;
    process.env.VERCEL_ENV = "preview";
    assert.throws(() => assertWorkbookMirrorAllowed(), /from Vercel/);
    delete process.env.VERCEL_ENV;
    assert.doesNotThrow(() => assertWorkbookMirrorAllowed());
  } finally {
    const names = {
      vercel: "VERCEL_ENV",
      event: "GITHUB_EVENT_NAME",
      ref: "GITHUB_REF",
      actions: "GITHUB_ACTIONS",
      enabled: "WORKBOOK_MIRROR_ENABLED",
      dry: "WORKBOOK_MIRROR_DRY_RUN",
    } as const;
    for (const [key, name] of Object.entries(names)) {
      const value = saved[key as keyof typeof saved];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("import skips an entity while its read flag is on", async () => {
  const previousRead = process.env.READ_STAGES_FROM_DB;
  const previousApi = process.env.CHANGES_API_ENABLED;
  const previousEnv = process.env.VERCEL_ENV;
  process.env.READ_STAGES_FROM_DB = "1";
  process.env.CHANGES_API_ENABLED = "1";
  delete process.env.VERCEL_ENV;
  try {
    const sql = await memorySql();
    await migrate(sql);
    const imported = await importChanged(
      sql,
      {
        stages: [{ site_id: "PIPE-PHX-0001", stage: "1 Desk screen", market: "PHX", service_area_class: "", reason: "" }],
        activities: [],
        comms: [],
      },
      "snap-cutover",
    );
    assert.deepEqual(entitiesToMirror(), ["stage"]);
    assert.deepEqual(imported.cut_over, ["stage"]);
    assert.equal(imported.inserted.stage, 0);
    const rows = await sql.query<{ n: number | string }>("SELECT count(*)::int AS n FROM site_stages");
    assert.equal(Number(rows.rows[0]?.n), 0);
  } finally {
    if (previousRead === undefined) delete process.env.READ_STAGES_FROM_DB;
    else process.env.READ_STAGES_FROM_DB = previousRead;
    if (previousApi === undefined) delete process.env.CHANGES_API_ENABLED;
    else process.env.CHANGES_API_ENABLED = previousApi;
    if (previousEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousEnv;
  }
});
