import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate.ts";
import {
  cancelledMirrorNote,
  newMirrorRunId,
  recordMirrorRun,
  saveMirrorRun,
  watchMirrorCancel,
  type MirrorWritePhase,
} from "../../lib/changes/mirror.ts";
import { memorySql } from "../helpers/sql.ts";

test("a cancelled mirror keeps the runs row and does not reopen it", async () => {
  const sql = await memorySql();
  await migrate(sql);
  const id = newMirrorRunId();
  await saveMirrorRun(sql, id, { cells: 2 }, "writing cells", "running");
  const running = await sql.query<{ status: string; finished_at: Date | null; notes: string }>(
    "SELECT status, finished_at, notes FROM runs WHERE id = $1",
    [id],
  );
  assert.equal(running.rows[0]?.status, "running");
  assert.equal(running.rows[0]?.finished_at, null);
  assert.equal(running.rows[0]?.notes, "writing cells");

  await saveMirrorRun(sql, id, { cells: 2 }, cancelledMirrorNote("writing"), "failed");
  await saveMirrorRun(sql, id, { cells: 9 }, "writing cells", "running");
  const cancelled = await sql.query<{ status: string; finished_at: Date | null; notes: string; cells: number }>(
    "SELECT status, finished_at, notes, counts->>'cells' AS cells FROM runs WHERE id = $1",
    [id],
  );
  assert.equal(cancelled.rows.length, 1);
  assert.equal(cancelled.rows[0]?.status, "failed");
  assert.ok(cancelled.rows[0]?.finished_at);
  assert.equal(cancelled.rows[0]?.notes, "cancelled while writing cells");
  assert.equal(String(cancelled.rows[0]?.cells), "2");

  const longId = newMirrorRunId();
  await saveMirrorRun(sql, longId, { cells: 1 }, `${"n".repeat(600)}SECRET`, "succeeded");
  const clipped = await sql.query<{ notes: string; status: string }>("SELECT notes, status FROM runs WHERE id = $1", [longId]);
  assert.equal(clipped.rows[0]?.status, "succeeded");
  assert.equal(clipped.rows[0]?.notes.length, 500);
  assert.equal(clipped.rows[0]?.notes.includes("SECRET"), false);

  await recordMirrorRun(sql, { cells: 4 }, "wrote cells", "succeeded");
  const recorded = await sql.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM runs WHERE notes = 'wrote cells' AND status = 'succeeded'",
  );
  assert.equal(Number(recorded.rows[0]?.n), 1);
});

test("a cancel signal records the phase and exits once", async () => {
  assert.equal(cancelledMirrorNote("idle"), "cancelled before the sheet write finished");
  assert.equal(cancelledMirrorNote("written"), "cancelled after writing cells");
  const notes: string[] = [];
  const signals: string[] = [];
  let exitCode = 0;
  let phase: MirrorWritePhase = "written";
  watchMirrorCancel(
    () => phase,
    async (note) => {
      notes.push(note);
    },
    (code) => {
      exitCode = code;
    },
    (signal, handler) => {
      signals.push(signal);
      handler();
      handler();
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(signals, ["SIGTERM", "SIGINT"]);
  assert.deepEqual(notes, ["cancelled after writing cells"]);
  assert.equal(exitCode, 1);

  const source = readFileSync("scripts/workbook-mirror.ts", "utf8");
  const watchAt = source.indexOf("watchMirrorCancel(");
  const runningAt = source.indexOf('"writing cells", "running"');
  const writeAt = source.indexOf("await writeCells(");
  assert.ok(watchAt > 0 && runningAt > watchAt && writeAt > runningAt);
  assert.match(readFileSync("lib/changes/mirror.ts", "utf8"), /process\.once\(signal, handler\)/);
});
