import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { importChanged } from "../../lib/changes/backfill";
import {
  PROTECTED_ROW,
  PROTECTED_SITE_ID,
  a1,
  assertMirrorRefusals,
  assertPlannedWrites,
  assertReadBack,
  assertWorkbookMirrorAllowed,
  entitiesToMirror,
  formatMirrorDrift,
  formatPlan,
  formatPlanSummary,
  mirrorDrift,
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

test("an activity date serial matches the stored calendar date", () => {
  const plan = planActivityMirror(
    table("Activity", 1, ["Event ID", "Date", "Site ID", "Type", "Summary"], [["A-000001", "46316", "PIPE-PHX-0001", "listing", "Listing noted"]]),
    [{ entity_id: "A-000001", site_id: "PIPE-PHX-0001", date: "2026-10-21", type: "listing", summary: "Listing noted", source_link: "" }],
  );
  assert.equal(plan.changes.length, 0);
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
  assert.throws(() => assertPlannedWrites([{ ...change, id: PROTECTED_SITE_ID }]), /quarantined site/);
  assert.throws(() => assertPlannedWrites([{ ...change, after: PROTECTED_SITE_ID }]), /quarantined site/);
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

test("a site-flag simulation is a dry run and the plan summary counts entities", () => {
  const names = ["SIMULATE_SITE_FLAG", "WORKBOOK_MIRROR_DRY_RUN", "WORKBOOK_MIRROR_ENABLED", "READ_STAGES_FROM_DB", "READ_ACTIVITY_FROM_DB", "READ_COMMS_FROM_DB", "READ_SITES_FROM_DB", "CHANGES_API_ENABLED", "VERCEL_ENV", "GITHUB_EVENT_NAME", "GITHUB_ACTIONS", "GITHUB_REF"] as const;
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const restore = () => {
    for (const name of names) {
      const value = saved[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  try {
    for (const name of names) delete process.env[name];
    process.env.SIMULATE_SITE_FLAG = "1";
    process.env.CHANGES_API_ENABLED = "0";
    assert.throws(() => assertWorkbookMirrorAllowed(), /simulate_site_flag is only allowed when dry_run is true/);
    process.env.WORKBOOK_MIRROR_DRY_RUN = "1";
    assert.doesNotThrow(() => assertWorkbookMirrorAllowed());
    assert.deepEqual(entitiesToMirror(), ["site"]);
    delete process.env.SIMULATE_SITE_FLAG;
    assert.deepEqual(entitiesToMirror(), []);

    const note = "On hold - broker Nov 6: the package is in the folder.";
    const summary = formatPlanSummary([
      { sheet: "Pipeline", row: 5, column: 4, header: "Stage", id: "PIPE-PHX-0001", before: "1 Desk screen", after: "2 Financial screen" },
      { sheet: "Land Sites", row: 11, column: 6, header: "Next step", id: "LAND-PHX-0064", before: "Confirm the zoning.", after: note },
      { sheet: "Activity", row: 2, column: 5, header: "Summary", id: "A-000001", before: "Called", after: note },
      { sheet: "Comms Log", row: 3, column: 10, header: "Summary", id: "CM-0001", before: "Called", after: note },
      { sheet: "Comms Log", row: 4, column: 10, header: "Summary", id: "CM-0002", before: "Wrote", after: "Sent the note." },
    ]);
    assert.equal(summary, "site 1\nstage 1\nactivity 1\ncomms 2");
    assert.equal(summary.includes(note), false);
    assert.equal(summary.includes("Confirm the zoning."), false);
  } finally {
    restore();
  }
});

test("a hand edit of an activity row is overwritten from the database", () => {
  const sheetText = "Sheet row kept only on the workbook";
  const dbText = "Database row is the record";
  const sheet = table("Activity", 1, ["Event ID", "Date", "Site ID", "Type", "Summary"], [
    ["A-000272", "2026-11-06", "LAND-PHX-0046", "email", sheetText],
  ]);
  const plan = planActivityMirror(sheet, [
    { entity_id: "A-000272", site_id: "PIPE-PHX-0001", date: "2026-11-15", type: "visit", summary: dbText, source_link: "", imported: false },
    { entity_id: "A-000274", site_id: "PIPE-PHX-0001", date: "2026-11-15", type: "visit", summary: dbText, source_link: "", imported: false },
    { entity_id: "A-000275", site_id: PROTECTED_SITE_ID, date: "2026-11-15", type: "visit", summary: dbText, source_link: "", imported: false },
  ]);
  assert.deepEqual(plan.refused, []);
  assert.equal(plan.changes.some((change) => change.id === "A-000272" && change.header === "Summary" && change.after === dbText), true);
  assert.equal(plan.appended, 1);
  assert.equal(plan.changes.some((change) => change.id === "A-000275" || change.after === PROTECTED_SITE_ID || change.before === PROTECTED_SITE_ID), false);
  assert.equal(JSON.stringify(plan).includes(PROTECTED_SITE_ID), false);
  const drift = formatMirrorDrift(mirrorDrift(plan.changes));
  assert.equal(drift.includes(sheetText), false);
  assert.equal(drift.includes(dbText), false);
  assert.equal(drift.includes("A-000272"), false);
  assert.match(drift, /drift_cells [1-9]/);
  assert.match(drift, /#[0-9a-f]{12}/);
  assert.match(drift, /overwrites drifted cells/);
  assert.throws(() => assertMirrorRefusals(["A-000272"]), (error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    assert.match(message, /A-000272/);
    assert.equal(message.includes(dbText), false);
    assert.equal(message.includes(sheetText), false);
    return true;
  });
});

test("a comms summary that only shortens the sheet is not written, and a trailing PT matches", () => {
  const full = `${"x".repeat(40)} tail`;
  const clipped = "x".repeat(40);
  const sheet = table("Comms Log", 1, ["Comms ID", "Date/time", "Summary", "Direction"], [
    ["CM-0382", "2026-11-06 09:00 PT", full, "in"],
  ]);
  const plan = planCommsMirror(sheet, [
    { entity_id: "CM-0382", values: { at: "2026-11-06 09:00", summary: clipped, direction: "in" } },
    { entity_id: "CM-0581", values: { at: "2026-11-15 10:00", summary: "New row", direction: "out" } },
  ]);
  assert.equal(plan.changes.some((change) => change.id === "CM-0382"), false);
  assert.deepEqual(plan.held.map((row) => row.id), ["CM-0382"]);
  const stamped = plan.changes.find((change) => change.id === "CM-0581" && change.header === "Date/time");
  assert.equal(stamped?.after, "2026-11-15 10:00 PT");
  assert.equal(plan.appended, 1);
});

test("activity and comms plan lines are hashed", () => {
  const note = "Visited and left a sample note.";
  const link = "https://example.test/message";
  const plan = formatPlan([
    { sheet: "Activity", row: 3, column: 5, header: "Summary", id: "A-000274", before: "", after: note },
    { sheet: "Comms Log", row: 4, column: 3, header: "Link", id: "CM-0382", before: link, after: "" },
    { sheet: "Comms Log", row: 4, column: 10, header: "Summary", id: "CM-0382", before: note, after: `${note} more` },
    { sheet: "Activity", row: 3, column: 2, header: "Date", id: "A-000274", before: "", after: "2026-11-15" },
  ]);
  assert.equal(plan.includes(note), false);
  assert.equal(plan.includes(link), false);
  assert.equal(plan.includes("example.test"), false);
  assert.match(plan, /Summary A-000274: #[0-9a-f]{12} -> #[0-9a-f]{12}/);
  assert.match(plan, /Link CM-0382: #[0-9a-f]{12} -> #[0-9a-f]{12}/);
  assert.match(plan, /Date A-000274: #[0-9a-f]{12} -> #[0-9a-f]{12}/);
});
