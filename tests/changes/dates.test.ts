import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { importChanged } from "../../lib/changes/backfill";
import { formatDatePlan, planDateRestore } from "../../lib/changes/dates";
import { buildReport, renderReport } from "../../lib/changes/diff";
import { planActivityMirror, planCommsMirror, planSiteMirror, type SheetTable } from "../../lib/changes/mirror";
import { validateBatch, type Actor } from "../../lib/changes/schema";
import { commsWhenText } from "../../lib/comms";
import { memorySql } from "../helpers/sql";

const human: Actor = { id: "jaideep", kind: "human", role: "reviewer" };
const RICH = "2026-11-13 ~18:20-18:40 PT";
const MORNING = "2026-11-14 PT (morning)";

function table(title: string, headers: string[], body: string[][]): SheetTable {
  return { title, headerRow: 1, headers, rows: body.map((cells, index) => ({ row: index + 2, cells })) };
}

test("an empty or shorter comms time is not written over sheet text", () => {
  const sheet = table("Comms Log", ["Comms ID", "Date/time", "Summary"], [
    ["CM-0469", RICH, "Noted"],
    ["CM-0525", MORNING, "Noted"],
  ]);
  const blank = planCommsMirror(sheet, [
    { entity_id: "CM-0469", values: { at: "", summary: "Noted", direction: "in" } },
    { entity_id: "CM-0525", values: { at: "2026-11-14", summary: "Noted", direction: "in" } },
  ]);
  assert.equal(blank.changes.length, 0);
  assert.deepEqual(blank.held.map((row) => row.id), ["CM-0469", "CM-0525"]);

  const kept = planCommsMirror(sheet, [
    { entity_id: "CM-0469", values: { at: "", at_text: RICH, summary: "Noted", direction: "in" } },
  ]);
  assert.equal(kept.changes.length, 0);
  assert.equal(kept.held.length, 0);
});

test("an approximate time is marked only when the sheet cell can take it", () => {
  const iso = "2026-11-15T18:20:00-08:00";
  const plain = table("Comms Log", ["Comms ID", "Date/time"], [["CM-0001", "2026-11-15 18:20"]]);
  const marked = planCommsMirror(plain, [
    { entity_id: "CM-0001", values: { at: `${iso} (approx.)`, at_iso: iso, at_approximate: "1" } },
  ]);
  assert.equal(marked.changes[0]?.after, `${iso} (approx.)`);
  const rich = table("Comms Log", ["Comms ID", "Date/time"], [["CM-0469", RICH]]);
  const held = planCommsMirror(rich, [
    { entity_id: "CM-0469", values: { at: `${iso} (approx.)`, at_iso: iso, at_approximate: "1" } },
  ]);
  assert.equal(held.changes.length, 0);
  assert.equal(held.held[0]?.id, "CM-0469");
});

test("activity and site dates are not blanked", () => {
  const activity = planActivityMirror(
    table("Activity", ["Event ID", "Date", "Site ID", "Type", "Summary"], [["A-000001", "2026-11-06", "PIPE-PHX-0001", "listing", "Noted"]]),
    [{ entity_id: "A-000001", site_id: "PIPE-PHX-0001", date: "", type: "listing", summary: "Noted", source_link: "" }],
  );
  assert.equal(activity.changes.some((change) => change.header === "Date"), false);
  assert.equal(activity.held.some((row) => row.header === "Date"), true);
  const site = planSiteMirror(
    [table("Pipeline", ["Site ID", "Last checked live"], [["PIPE-PHX-0001", "2026-11-06"]])],
    [{ site_id: "PIPE-PHX-0001", writes: { "Last checked live": "" } }],
  );
  assert.equal(site.changes.length, 0);
  assert.equal(site.held[0]?.header, "Last checked live");
});

test("the shadow diff flags a blank database date against sheet text", () => {
  const report = buildReport(
    { stages: [], activities: [], sites: [], comms: [row("CM-0469", "", RICH)] },
    { stages: [], activities: [], sites: [], comms: [row("CM-0469", "", "")] },
    "sheet",
  );
  const change = report.entities.comms.changed.find((item) => item.field === "at_text");
  assert.equal(change?.blanked, true);
  const rendered = renderReport(report);
  assert.match(rendered, /CM-0469 at_text blank #[0-9a-f]{12}/);
  assert.equal(rendered.includes(RICH), false);
});

test("the changes API requires a zoned timestamp and stores an approximate flag", () => {
  assert.throws(
    () => validateBatch(human, "free-at", { changes: [comms({ at: "morning" })] }),
    /ISO-8601 time with a zone offset/,
  );
  assert.throws(
    () => validateBatch(human, "free-date", { changes: [activity("tomorrow")] }),
    /ISO-8601 time with a zone offset/,
  );
  assert.throws(
    () => validateBatch(human, "calendar", { changes: [activity("2026-11-15")] }),
    /ISO-8601 time with a zone offset/,
  );
  const iso = "2026-11-15T18:20:00-08:00";
  const accepted = validateBatch(human, "zoned", {
    changes: [activity(iso), comms({ at: iso, at_approximate: true })],
  });
  const activityPayload = accepted.changes[0]?.payload as { date: string; date_iso?: string };
  const commsPayload = accepted.changes[1]?.payload as { at?: string; at_approximate?: boolean };
  assert.equal(activityPayload.date, "2026-11-15");
  assert.equal(activityPayload.date_iso, iso);
  assert.equal(commsPayload.at, iso);
  assert.equal(commsPayload.at_approximate, true);
  assert.equal(commsWhenText(iso, true), "2026-11-15 18:20 PT (approximate)");
});

test("a new import keeps unparsed date text and a later import does not fill an old blank", async () => {
  const sql = await memorySql();
  await migrate(sql);
  const base = commsRow("CM-0469", "");
  await importChanged(sql, { stages: [], activities: [], comms: [base] }, "snap-blank");
  const filled = await importChanged(
    sql,
    { stages: [], activities: [], comms: [{ ...base, at_text: RICH }, commsRow("CM-9002", RICH)] },
    "snap-text",
  );
  assert.equal(filled.inserted.comms, 1);
  const rows = await sql.query<{ entity_id: string; at_text: string }>(
    `SELECT entity_id, payload->>'at_text' AS at_text FROM comms_entries ORDER BY entity_id`,
  );
  assert.equal(rows.rows.find((row) => row.entity_id === "CM-0469")?.at_text || "", "");
  assert.equal(rows.rows.find((row) => row.entity_id === "CM-9002")?.at_text, RICH);
});

test("the date restore plan prints ids, lengths, and hashes", () => {
  const plan = planDateRestore(
    [{ entity_id: "CM-0469", site_id: "PIPE-PHX-0001", at: "", at_text: "", version: 1 }],
    new Map([["CM-0469", RICH]]),
  );
  const line = formatDatePlan(plan);
  assert.match(line, /^CM-0469 \d+ #[0-9a-f]{12}$/);
  assert.equal(line.includes(RICH), false);
  assert.equal(line.includes("~"), false);
});

test("the repair workflow stays manual and confirm-gated", () => {
  const workflow = readFileSync(".github/workflows/workbook-repairs.yml", "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /default: true/);
  assert.match(workflow, /renumber-activity/);
  assert.match(workflow, /restore-comms-summaries/);
  assert.match(workflow, /restore-comms-dates/);
  assert.match(workflow, /CONFIRM_INPUT" != "\$expected"/);
  assert.match(workflow, /secrets\.NEON_DATABASE_URL/);
  assert.match(workflow, /secrets\.GOOGLE_SERVICE_ACCOUNT_JSON/);
  assert.equal(workflow.includes("--apply"), true);
});

function comms(payload: Record<string, unknown>) {
  return {
    entity_type: "comms" as const,
    site_id: "PIPE-PHX-0001",
    expected_version: 0,
    source: "call log",
    payload: { direction: "in", summary: "Noted", ...payload },
  };
}

function activity(date: string) {
  return {
    entity_type: "activity" as const,
    site_id: "PIPE-PHX-0001",
    expected_version: 0,
    source: "listing note",
    payload: { date, type: "listing" as const, summary: "Listing noted" },
  };
}

function row(id: string, at: string, atText: string) {
  return {
    entity_id: id,
    site_id: "PIPE-PHX-0001",
    site_ids: "PIPE-PHX-0001",
    direction: "in",
    at,
    at_text: atText,
    person: "",
    firm: "",
    channel: "",
    summary: "Noted",
    subject: "",
    thread_id: "",
    link: "",
    asks_made: "",
    asks_answered: "",
    attachments: "",
    state_changes: "",
    workbook_source: "",
    message_id: "",
  };
}

function commsRow(id: string, atText: string) {
  return { ...row(id, "", atText) };
}
