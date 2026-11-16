import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { EXCLUDED_SITE_ID } from "../../lib/alerts/excluded";
import {
  applyCaptureImport,
  assertCaptureImportApply,
  formatCapturePlan,
  loadCapturePlan,
  parseCaptureWhen,
  type CaptureSheetRow,
} from "../../lib/changes/captureImport";
import { validateBatch, type Actor } from "../../lib/changes/schema";
import { shortHash } from "../../lib/changes/site";
import { presentCard } from "../../lib/timeline/filter";
import { memorySql } from "../helpers/sql";

const muse: Actor = { id: "muse", kind: "agent" };
const indie: Actor = { id: "indie", kind: "agent" };
const contributor: Actor = { id: "cindel", kind: "human", role: "contributor" };
const DATED = "A-010043";
const TIMED = "A-010044";

function captureChange(actorReady = true) {
  return {
    entity_type: "activity",
    site_id: "PIPE-PHX-0001",
    expected_version: 0,
    source: actorReady ? "desk note" : "desk note",
    payload: { date: "2026-11-16T09:00:00-08:00", type: "capture", summary: "Site added" },
  };
}

test("Muse can record a capture and another agent token cannot", () => {
  assert.doesNotThrow(() => validateBatch(muse, "muse-capture", { changes: [captureChange()] }));
  assert.doesNotThrow(() => validateBatch(contributor, "human-capture", { changes: [captureChange()] }));
  assert.throws(() => validateBatch(indie, "indie-capture", { changes: [captureChange()] }), /cannot write that activity/);
  const card = presentCard(
    {
      records: {},
      items: [
        { record_id: "PIPE-PHX-0001", event_id: "A-010043", date: "2026-11-01", type: "capture", summary: "Capture logged", at_approximate: true },
        { record_id: "PIPE-PHX-0001", event_id: "A-010099", date: "2026-11-01", type: "call", summary: "A neutral line" },
      ],
    },
    ["PIPE-PHX-0001"],
  );
  assert.equal(card.items.length, 1);
  assert.equal(card.items[0]?.type, "capture");
  assert.equal(card.items[0]?.approximate, true);
  const ui = readFileSync("components/timeline/Timeline.tsx", "utf8");
  assert.match(ui, /capture: "Capture"/);
});

test("a date-only capture stays approximate and the import is idempotent", async () => {
  assert.deepEqual(parseCaptureWhen("2026-11-01"), { date: "2026-11-01", approximate: true });
  assert.equal(parseCaptureWhen("2026-11-02T15:04:00-08:00")?.approximate, false);
  assert.equal(parseCaptureWhen("2026-11-02T15:04:00-08:00")?.dateIso, "2026-11-02T15:04:00-08:00");
  const rows: CaptureSheetRow[] = [
    { entityId: DATED, siteId: "PIPE-LAS-0004", when: "2026-11-01", summary: "Capture logged", sourceLink: "" },
    { entityId: TIMED, siteId: "PIPE-PHX-0001", when: "2026-11-02T15:04:00-08:00", summary: "Timed capture", sourceLink: "" },
    { entityId: "A-010045", siteId: EXCLUDED_SITE_ID, when: "2026-11-01", summary: "Leave this out", sourceLink: "" },
  ];
  const sql = await memorySql();
  await migrate(sql);
  const plan = await loadCapturePlan(sql, rows);
  const printed = formatCapturePlan(plan);
  assert.match(printed, /insert 2/);
  assert.match(printed, new RegExp(`#${shortHash(DATED)}`));
  assert.match(printed, new RegExp(`#${shortHash(TIMED)}`));
  assert.equal(printed.includes(DATED), false);
  assert.equal(printed.includes(TIMED), false);
  assert.equal(printed.includes("PIPE-LAS-0004"), false);
  assert.equal(printed.includes(EXCLUDED_SITE_ID), false);
  assert.equal(printed.includes(shortHash(EXCLUDED_SITE_ID)), false);
  assert.equal(printed.includes("Capture logged"), false);
  assert.equal(printed.includes("Leave this out"), false);
  assert.equal(plan.inserts.find((item) => item.hash === shortHash(DATED))?.approximate, true);
  assert.equal(plan.inserts.find((item) => item.hash === shortHash(TIMED))?.approximate, false);

  assert.equal(await applyCaptureImport(sql, plan), 2);
  const stored = await sql.query<{ entity_id: string; payload: { type?: string; date?: string; at_approximate?: boolean; date_iso?: string } }>(
    "SELECT entity_id, payload FROM activities ORDER BY entity_id",
  );
  assert.deepEqual(stored.rows.map((row) => row.entity_id), [DATED, TIMED]);
  assert.equal(stored.rows[0]?.payload.type, "capture");
  assert.equal(stored.rows[0]?.payload.date, "2026-11-01");
  assert.equal(stored.rows[0]?.payload.at_approximate, true);
  assert.equal(stored.rows[1]?.payload.date_iso, "2026-11-02T15:04:00-08:00");
  assert.equal(stored.rows[1]?.payload.at_approximate, undefined);
  const events = await sql.query<{ source: string }>("SELECT source FROM events WHERE entity_type = 'activity'");
  assert.ok(events.rows.every((row) => row.source === "workbook row"));

  const again = await loadCapturePlan(sql, rows);
  assert.equal(again.inserts.length, 0);
  assert.equal(again.updates.length, 0);
  assert.equal(again.unchanged, 2);
  assert.equal(await applyCaptureImport(sql, again), 0);
});

test("capture import refuses production and stays a dry run without confirm", () => {
  const saved = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "production";
  try {
    assert.throws(() => assertCaptureImportApply("postgres://localhost/app", "import-capture-activity"), /production/);
  } finally {
    if (saved === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = saved;
  }
  assert.throws(() => assertCaptureImportApply("postgres://localhost/app", ""), /Dry run/);
});
