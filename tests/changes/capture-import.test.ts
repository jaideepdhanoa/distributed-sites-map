import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Sql } from "../../lib/actions/db";
import { migrate } from "../../lib/actions/migrate";
import { EXCLUDED_SITE_ID } from "../../lib/alerts/excluded";
import { applyBatch } from "../../lib/changes/apply";
import {
  CAPTURE_IMPORT_CONFIRM,
  CAPTURE_IMPORT_WORKFLOW,
  CAPTURE_RUN_NOTE,
  applyCaptureImport,
  assertCaptureImportApply,
  captureArtifact,
  captureProvenance,
  executeCaptureImport,
  formatCapturePlan,
  parseCaptureWhen,
  productionCaptureApproved,
  type CaptureApplyContext,
  type CapturePlan,
  type CaptureSheetRow,
} from "../../lib/changes/captureImport";
import { loadMirrorRows } from "../../lib/changes/mirror";
import { planActivityRenumber } from "../../lib/changes/renumber";
import { validateBatch, type Actor } from "../../lib/changes/schema";
import { presentCard } from "../../lib/timeline/filter";
import { memorySql } from "../helpers/sql";

const muse: Actor = { id: "muse", kind: "agent" };
const indie: Actor = { id: "indie", kind: "agent" };
const contributor: Actor = { id: "cindel", kind: "human", role: "contributor" };
const DATED = "A-010043";
const TIMED = "A-010044";
const UNZONED = "A-010046";
const DATABASE_URL = "postgres://localhost/app";
const AT = "2026-11-16T14:56:00.000+00:00";
const SECRET_SUMMARY = "Broker asked jane@firm.example for $1,200,000";
const SECRET_LINK = "https://mail.google.com/mail/u/0/#inbox/18c4f2ab";
const ENV_KEYS = [
  "VERCEL_ENV",
  "ALLOW_PRODUCTION_CAPTURE_IMPORT",
  "GITHUB_EVENT_NAME",
  "GITHUB_REF",
  "GITHUB_WORKFLOW",
  "NEON_DATABASE_URL",
  "NEON_PRODUCTION_HOST",
] as const;

function sheetRows(): CaptureSheetRow[] {
  return [
    { entityId: DATED, siteId: "PIPE-LAS-0004", when: "2026-11-01", summary: SECRET_SUMMARY, sourceLink: SECRET_LINK },
    { entityId: TIMED, siteId: "PIPE-PHX-0001", when: "2026-11-02T15:04:00-08:00", summary: "Timed capture", sourceLink: "" },
    { entityId: UNZONED, siteId: "pipe-mia-0002", when: "2026-11-03 15:04", summary: "Clock without a zone", sourceLink: "" },
    { entityId: "A-010045", siteId: EXCLUDED_SITE_ID, when: "2026-11-01", summary: "Leave this out", sourceLink: SECRET_LINK },
    { entityId: "A-010047", siteId: "PIPE-LAS-0004", when: "not-a-date jane@firm.example", summary: SECRET_SUMMARY, sourceLink: "" },
  ];
}

function writeContext(overrides: Partial<CaptureApplyContext> = {}): CaptureApplyContext {
  return { confirm: CAPTURE_IMPORT_CONFIRM, databaseUrl: DATABASE_URL, who: "jaideep", at: AT, ...overrides };
}

async function ready(): Promise<Sql> {
  const sql = await memorySql();
  await migrate(sql);
  return sql;
}

async function counts(sql: Sql): Promise<{ activities: number; events: number; runs: number }> {
  const activities = await sql.query<{ n: number | string }>("SELECT count(*)::int AS n FROM activities");
  const events = await sql.query<{ n: number | string }>("SELECT count(*)::int AS n FROM events");
  const runs = await sql.query<{ n: number | string }>("SELECT count(*)::int AS n FROM runs");
  return {
    activities: Number(activities.rows[0]?.n),
    events: Number(events.rows[0]?.n),
    runs: Number(runs.rows[0]?.n),
  };
}

function saveEnv(): Map<string, string | undefined> {
  return new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(saved: Map<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearProductionEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

function approveProductionEnv(): void {
  process.env.ALLOW_PRODUCTION_CAPTURE_IMPORT = "1";
  process.env.GITHUB_EVENT_NAME = "workflow_dispatch";
  process.env.GITHUB_REF = "refs/heads/main";
  process.env.GITHUB_WORKFLOW = CAPTURE_IMPORT_WORKFLOW;
}

function assertPrivate(text: string): void {
  assert.equal(text.includes(SECRET_SUMMARY), false);
  assert.equal(text.includes(SECRET_LINK), false);
  assert.equal(text.includes("jane@firm.example"), false);
  assert.equal(text.includes("$1,200,000"), false);
  assert.equal(text.includes("18c4f2ab"), false);
  assert.equal(text.includes("mail.google"), false);
  assert.equal(text.includes("Leave this out"), false);
  assert.equal(text.includes(EXCLUDED_SITE_ID), false);
  assert.equal(text.includes("15:04"), false);
}

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

test("a date-only capture stays approximate and an unzoned clock is not stored as a time", () => {
  assert.deepEqual(parseCaptureWhen("2026-11-01"), { date: "2026-11-01", approximate: true });
  assert.deepEqual(parseCaptureWhen("11/1/2026"), { date: "2026-11-01", approximate: true });
  assert.equal(parseCaptureWhen("2026-11-02T15:04:00-08:00")?.approximate, false);
  assert.equal(parseCaptureWhen("2026-11-02T15:04:00-08:00")?.dateIso, "2026-11-02T15:04:00-08:00");
  const unzoned = parseCaptureWhen("2026-11-03 15:04");
  assert.deepEqual(unzoned, { date: "2026-11-03", approximate: true });
  assert.equal(unzoned && "dateIso" in unzoned, false);
});

test("dry-run lists ids and writes nothing, including when the confirm phrase is present", async () => {
  const saved = saveEnv();
  try {
    clearProductionEnv();
    const sql = await ready();
    const before = await counts(sql);
    const preview = await executeCaptureImport(sql, sheetRows(), {
      apply: false,
      mode: "dry-run",
      databaseUrl: DATABASE_URL,
      confirm: CAPTURE_IMPORT_CONFIRM,
      who: "jaideep",
      at: AT,
    });
    assert.deepEqual(await counts(sql), before);
    assert.equal(preview.written, 0);
    assert.match(preview.text, /^mode dry-run/);
    assert.match(preview.text, /insert 3/);
    assert.match(preview.text, /excluded 1/);
    assert.match(preview.text, /PIPE-LAS-0004 insert 1 existing 0/);
    assert.match(preview.text, /PIPE-PHX-0001 insert 1 existing 0/);
    assert.match(preview.text, /PIPE-MIA-0002 insert 1 existing 0/);
    assert.match(preview.text, new RegExp(`- insert ${DATED} PIPE-LAS-0004 capture 2026-11-01 approximate`));
    assert.match(preview.text, new RegExp(`- insert ${TIMED} PIPE-PHX-0001 capture 2026-11-02 exact`));
    assert.match(preview.text, new RegExp(`- insert ${UNZONED} PIPE-MIA-0002 capture 2026-11-03 approximate`));
    assertPrivate(preview.text);
    assertPrivate(JSON.stringify(preview.artifact));
    assert.equal(preview.artifact.rows.find((row) => row.id === DATED)?.approximate, true);
    assert.equal(preview.artifact.rows.some((row) => row.site_id === EXCLUDED_SITE_ID), false);
    assert.equal(formatCapturePlan(preview.plan), preview.text);
    assert.deepEqual(captureArtifact(preview.plan, "dry-run"), preview.artifact);
  } finally {
    restoreEnv(saved);
  }
});

test("write requires the confirm phrase and production requires the workflow approval", async () => {
  const saved = saveEnv();
  try {
    clearProductionEnv();
    assert.throws(() => assertCaptureImportApply("postgres://role@preview.example.test/app", CAPTURE_IMPORT_CONFIRM), /remote database/);
    assert.doesNotThrow(() => assertCaptureImportApply(DATABASE_URL, CAPTURE_IMPORT_CONFIRM));
    const sql = await ready();
    const rows = sheetRows();
    await assert.rejects(
      () => executeCaptureImport(sql, rows, { apply: true, mode: "write", databaseUrl: DATABASE_URL, confirm: "", who: "jaideep", at: AT }),
      /import-production/,
    );
    await assert.rejects(
      () => executeCaptureImport(sql, rows, { apply: true, mode: "write", databaseUrl: DATABASE_URL, confirm: "import-capture-activity", who: "jaideep", at: AT }),
      /import-production/,
    );
    await assert.rejects(
      () => executeCaptureImport(sql, rows, { apply: true, mode: "dry-run", databaseUrl: DATABASE_URL, confirm: CAPTURE_IMPORT_CONFIRM, who: "jaideep", at: AT }),
      /Set mode to write/,
    );
    assert.deepEqual(await counts(sql), { activities: 0, events: 0, runs: 0 });

    process.env.VERCEL_ENV = "production";
    assert.equal(productionCaptureApproved(), false);
    assert.throws(() => assertCaptureImportApply(DATABASE_URL, CAPTURE_IMPORT_CONFIRM), /production database/);
    await assert.rejects(
      () => applyCaptureImport(sql, emptyPlan(), writeContext()),
      /production database/,
    );
    assert.deepEqual(await counts(sql), { activities: 0, events: 0, runs: 0 });

    approveProductionEnv();
    process.env.VERCEL_ENV = "production";
    assert.equal(productionCaptureApproved(), true);
    assert.doesNotThrow(() => assertCaptureImportApply(DATABASE_URL, CAPTURE_IMPORT_CONFIRM));
    assert.throws(() => assertCaptureImportApply(DATABASE_URL, ""), /Dry run/);
  } finally {
    restoreEnv(saved);
  }
});

test("a write keeps workbook ids, sets the approximate flag, and leaves out PIPE-PHX-0006", async () => {
  const saved = saveEnv();
  try {
    clearProductionEnv();
    const sql = await ready();
    const written = await executeCaptureImport(sql, sheetRows(), {
      apply: true,
      mode: "write",
      databaseUrl: DATABASE_URL,
      confirm: CAPTURE_IMPORT_CONFIRM,
      who: "jaideep",
      at: AT,
    });
    assert.equal(written.written, 3);
    const stored = await sql.query<{
      entity_id: string;
      site_id: string;
      payload: {
        type?: string;
        date?: string;
        date_iso?: string;
        at_approximate?: boolean;
        provenance?: string;
        summary?: string;
        source_link?: string;
      };
    }>("SELECT entity_id, site_id, payload FROM activities ORDER BY entity_id");
    assert.deepEqual(stored.rows.map((row) => row.entity_id), [DATED, TIMED, UNZONED]);
    assert.equal(stored.rows.some((row) => row.site_id === EXCLUDED_SITE_ID), false);
    const dated = stored.rows[0]?.payload;
    assert.equal(dated?.type, "capture");
    assert.equal(dated?.date, "2026-11-01");
    assert.equal(dated?.date_iso, undefined);
    assert.equal(dated?.at_approximate, true);
    assert.equal(dated?.provenance, captureProvenance(DATED));
    assert.equal(dated?.summary, SECRET_SUMMARY);
    assert.equal(dated?.source_link, SECRET_LINK);
    assert.equal(JSON.stringify(dated).includes("T15:04"), false);
    const unzoned = stored.rows.find((row) => row.entity_id === UNZONED)?.payload;
    assert.equal(unzoned?.date, "2026-11-03");
    assert.equal(unzoned?.at_approximate, true);
    assert.equal(unzoned?.date_iso, undefined);
    assert.equal(JSON.stringify(unzoned).includes("15:04"), false);
    assert.equal(stored.rows.find((row) => row.entity_id === TIMED)?.payload.date_iso, "2026-11-02T15:04:00-08:00");
    assert.equal(stored.rows.find((row) => row.entity_id === TIMED)?.payload.at_approximate, undefined);

    const events = await sql.query<{ entity_id: string; source: string; actor: string }>(
      "SELECT entity_id, source, actor FROM events WHERE entity_type = 'activity' ORDER BY entity_id",
    );
    assert.deepEqual(
      events.rows.map((row) => row.source),
      [captureProvenance(DATED), captureProvenance(TIMED), captureProvenance(UNZONED)],
    );
    assert.ok(events.rows.every((row) => row.actor === "workbook-sync"));
    const runs = await sql.query<{ actor: string; notes: string; counts: unknown }>(
      "SELECT actor, notes, counts FROM runs WHERE notes = $1",
      [CAPTURE_RUN_NOTE],
    );
    assert.equal(runs.rows.length, 1);
    assert.equal(runs.rows[0]?.actor, "jaideep");
    const runCounts = typeof runs.rows[0]?.counts === "string" ? JSON.parse(runs.rows[0].counts) : runs.rows[0]?.counts;
    assert.equal(runCounts.mode, "write");
    assert.equal(runCounts.count, 3);
    assert.equal(runCounts.sites, 3);
    assert.equal(runCounts.at, AT);
    const floor = await sql.query<{ value: number | string }>("SELECT value FROM id_counters WHERE name = 'activity'");
    assert.ok(Number(floor.rows[0]?.value) >= 10046);

    const mirror = await loadMirrorRows(sql);
    assert.equal(mirror.activities.find((row) => row.entity_id === DATED)?.imported, true);
    const renumber = await planActivityRenumber(sql, 0, [DATED]);
    assert.equal(renumber.moves.length, 0);
    assert.equal(renumber.skipped[0]?.reason, "imported from the workbook");
  } finally {
    restoreEnv(saved);
  }
});

test("re-running skips existing ids and does not blank filled cells", async () => {
  const saved = saveEnv();
  try {
    clearProductionEnv();
    const sql = await ready();
    await sql.query(
      `INSERT INTO activities (entity_id, site_id, payload, version, updated_by)
       VALUES ($1, 'PIPE-PHX-0008', $2::jsonb, 4, 'muse')`,
      [
        "A-010050",
        JSON.stringify({
          date: "2026-10-01",
          date_iso: "2026-10-01T09:30:00-07:00",
          type: "capture",
          summary: "Kept the filled summary",
          source_link: "https://example.com/kept",
          provenance: "already recorded",
        }),
      ],
    );
    const rows: CaptureSheetRow[] = [
      ...sheetRows(),
      { entityId: "A-010050", siteId: "PIPE-PHX-0008", when: "2026-11-01", summary: "", sourceLink: "" },
    ];
    const first = await executeCaptureImport(sql, rows, {
      apply: true,
      mode: "write",
      databaseUrl: DATABASE_URL,
      confirm: CAPTURE_IMPORT_CONFIRM,
      who: "jaideep",
      at: AT,
    });
    assert.equal(first.written, 3);
    const before = await sql.query<{ payload: unknown }>("SELECT payload FROM activities WHERE entity_id = 'A-010050'");
    const again = await executeCaptureImport(sql, rows, {
      apply: true,
      mode: "write",
      databaseUrl: DATABASE_URL,
      confirm: CAPTURE_IMPORT_CONFIRM,
      who: "jaideep",
      at: AT,
    });
    assert.equal(again.written, 0);
    assert.equal(again.plan.inserts.length, 0);
    assert.equal(again.plan.existing, 4);
    assert.match(again.text, /existing 4/);
    assertPrivate(again.text);
    const after = await sql.query<{ payload: { summary?: string; source_link?: string; date_iso?: string; provenance?: string } }>(
      "SELECT payload FROM activities WHERE entity_id = 'A-010050'",
    );
    assert.deepEqual(after.rows[0]?.payload, before.rows[0]?.payload);
    assert.equal(after.rows[0]?.payload.summary, "Kept the filled summary");
    assert.equal(after.rows[0]?.payload.source_link, "https://example.com/kept");
    assert.equal(after.rows[0]?.payload.date_iso, "2026-10-01T09:30:00-07:00");
    const total = await counts(sql);
    assert.equal(total.activities, 4);
    const runs = await sql.query<{ n: number | string }>("SELECT count(*)::int AS n FROM runs WHERE notes = $1", [CAPTURE_RUN_NOTE]);
    assert.equal(Number(runs.rows[0]?.n), 2);

    const forced = emptyPlan();
    forced.inserts.push({
      hash: "excluded",
      entityId: "A-010045",
      siteId: EXCLUDED_SITE_ID,
      date: "2026-11-01",
      dateIso: "",
      approximate: true,
      summary: "Leave this out",
      sourceLink: "",
    });
    assert.equal(await applyCaptureImport(sql, forced, writeContext()), 0);
    const hidden = await sql.query<{ n: number | string }>("SELECT count(*)::int AS n FROM activities WHERE site_id = $1", [EXCLUDED_SITE_ID]);
    assert.equal(Number(hidden.rows[0]?.n), 0);
  } finally {
    restoreEnv(saved);
  }
});

test("Muse can correct an imported row through the changes API and the history stays", async () => {
  const saved = saveEnv();
  try {
    clearProductionEnv();
    const sql = await ready();
    await executeCaptureImport(sql, sheetRows(), {
      apply: true,
      mode: "write",
      databaseUrl: DATABASE_URL,
      confirm: CAPTURE_IMPORT_CONFIRM,
      who: "jaideep",
      at: AT,
    });
    const corrected = await applyBatch(sql, muse, "muse-correct-capture", {
      changes: [
        {
          entity_type: "activity",
          site_id: "PIPE-LAS-0004",
          entity_id: DATED,
          expected_version: 1,
          source: "desk note",
          payload: {
            date: "2026-11-01T15:04:00-08:00",
            type: "capture",
            summary: "Timed the visit",
            source_link: "https://example.com/visit",
            at_approximate: false,
          },
        },
      ],
    });
    assert.equal(corrected.results[0]?.entity_id, DATED);
    assert.equal(corrected.results[0]?.version, 2);
    const stored = await sql.query<{
      version: number | string;
      payload: {
        date?: string;
        date_iso?: string;
        at_approximate?: boolean;
        summary?: string;
        source_link?: string;
        provenance?: string;
      };
    }>("SELECT version, payload FROM activities WHERE entity_id = $1", [DATED]);
    assert.equal(Number(stored.rows[0]?.version), 2);
    assert.equal(stored.rows[0]?.payload.date, "2026-11-01");
    assert.equal(stored.rows[0]?.payload.date_iso, "2026-11-01T15:04:00-08:00");
    assert.equal(stored.rows[0]?.payload.at_approximate, undefined);
    assert.equal(stored.rows[0]?.payload.summary, "Timed the visit");
    assert.equal(stored.rows[0]?.payload.source_link, "https://example.com/visit");
    assert.equal(stored.rows[0]?.payload.provenance, captureProvenance(DATED));

    const history = await sql.query<{ source: string; actor: string; payload: { summary?: string; at_approximate?: boolean; date_iso?: string } }>(
      "SELECT source, actor, payload FROM events WHERE entity_id = $1 ORDER BY id",
      [DATED],
    );
    assert.equal(history.rows.length, 2);
    assert.equal(history.rows[0]?.source, captureProvenance(DATED));
    assert.equal(history.rows[0]?.actor, "workbook-sync");
    assert.equal(history.rows[0]?.payload.summary, SECRET_SUMMARY);
    assert.equal(history.rows[0]?.payload.at_approximate, true);
    assert.equal(history.rows[1]?.actor, "muse");
    assert.equal(history.rows[1]?.source, "desk note");
    assert.equal(history.rows[1]?.payload.summary, "Timed the visit");
    assert.equal(history.rows[1]?.payload.at_approximate, undefined);
    assert.equal(history.rows[1]?.payload.date_iso, "2026-11-01T15:04:00-08:00");

    const replay = await executeCaptureImport(sql, sheetRows(), {
      apply: true,
      mode: "write",
      databaseUrl: DATABASE_URL,
      confirm: CAPTURE_IMPORT_CONFIRM,
      who: "jaideep",
      at: AT,
    });
    assert.equal(replay.written, 0);
    const still = await sql.query<{ payload: { summary?: string; at_approximate?: boolean; date_iso?: string } }>(
      "SELECT payload FROM activities WHERE entity_id = $1",
      [DATED],
    );
    assert.equal(still.rows[0]?.payload.summary, "Timed the visit");
    assert.equal(still.rows[0]?.payload.at_approximate, undefined);
    assert.equal(still.rows[0]?.payload.date_iso, "2026-11-01T15:04:00-08:00");
    const historyAfter = await sql.query<{ n: number | string }>("SELECT count(*)::int AS n FROM events WHERE entity_id = $1", [DATED]);
    assert.equal(Number(historyAfter.rows[0]?.n), 2);
  } finally {
    restoreEnv(saved);
  }
});

test("the capture import workflow is manual, dry-run by default, and write needs the confirm phrase", () => {
  const workflow = readFileSync(".github/workflows/capture-import.yml", "utf8");
  const script = readFileSync("scripts/import-capture-activity.ts", "utf8");
  assert.match(workflow, /^name: Capture import/m);
  assert.equal(CAPTURE_IMPORT_WORKFLOW, "Capture import");
  assert.match(workflow, /^on:\n {2}workflow_dispatch:\n/m);
  assert.doesNotMatch(workflow, /schedule:|pull_request:/);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /mode:\n {8}description: dry-run writes nothing\. write copies capture rows into production\.\n {8}required: true\n {8}type: choice\n {8}default: dry-run\n {8}options:\n {10}- dry-run\n {10}- write/);
  assert.match(workflow, /confirm:\n {8}description: Type import-production to write\. Leave blank for a dry run\./);
  assert.match(workflow, /inputs\.mode == 'write' && inputs\.confirm != 'import-production'/);
  assert.match(workflow, /ALLOW_PRODUCTION_CAPTURE_IMPORT: \$\{\{ inputs\.mode == 'write' && inputs\.confirm == 'import-production' && '1' \|\| '0' \}\}/);
  assert.match(workflow, /IMPORT_ACTOR: \$\{\{ github\.actor \}\}/);
  assert.match(workflow, /NEON_DATABASE_URL: \$\{\{ secrets\.NEON_DATABASE_URL \}\}/);
  assert.match(workflow, /retention-days: 1/);
  assert.match(workflow, /scripts\/import-capture-activity\.ts --apply/);
  assert.match(script, /CONFIRM=import-production/);
  assert.match(script, /Dry run is the default/);
  assert.equal(workflow.includes(SECRET_SUMMARY), false);
  assert.equal(script.includes("console.log(rows"), false);
  assert.equal(script.includes("console.log(result.plan"), false);
});

function emptyPlan(): CapturePlan {
  return { inserts: [], existing: 0, skipped: [], excluded: 0, sites: [], rows: [], digest: "empty" };
}
