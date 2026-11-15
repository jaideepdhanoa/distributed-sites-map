import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { applyBatch, VersionConflictError } from "../../lib/changes/apply";
import { validateBatch, type Actor } from "../../lib/changes/schema";
import { memorySql } from "../helpers/sql";

const human: Actor = { id: "jaideep", kind: "human" };
const agent: Actor = { id: "indie", kind: "agent" };

function stage(stageName: string, extra: Record<string, unknown> = {}) {
  return {
    entity_type: "stage",
    site_id: "PIPE-PHX-0001",
    expected_version: 0,
    source: "desk review",
    payload: { stage: stageName, market: "PHX", ...extra },
  };
}

async function ready() {
  const sql = await memorySql();
  await migrate(sql);
  return sql;
}

test("validation rejects a bad market, class, source, agent drop, and a caller-chosen id", () => {
  assert.throws(() => validateBatch(human, "k1", { changes: [stage("1 Desk screen", { market: "Phoenix" })] }), /Market must be one of PHX/);
  assert.throws(
    () => validateBatch(human, "k1", { changes: [stage("1 Desk screen", { service_area_class: "Beside" })] }),
    /Service area class must be one of Inside/,
  );
  assert.throws(() => validateBatch(human, "k1", { changes: [{ ...stage("1 Desk screen"), source: "  " }] }), /Every change needs a source/);
  assert.throws(
    () => validateBatch(agent, "k1", { changes: [stage("Dropped", { reason: "Lot too small" })] }),
    /An agent cannot set Stage to Dropped/,
  );
  assert.throws(() => validateBatch(human, "k1", { changes: [stage("Dropped")] }), /Stage Dropped needs a reason/);
  assert.throws(
    () =>
      validateBatch(human, "k1", {
        changes: [
          {
            entity_type: "comms",
            site_id: "PIPE-PHX-0001",
            expected_version: 0,
            source: "call",
            payload: { direction: "internal" },
          },
        ],
      }),
    /Comms direction must be in or out/,
  );
  assert.throws(
    () =>
      validateBatch(human, "k1", {
        changes: [
          {
            entity_type: "activity",
            site_id: "PIPE-PHX-0001",
            entity_id: "A-000099",
            expected_version: 0,
            source: "listing",
            payload: { date: "2026-11-01", type: "listing", summary: "Listing noted" },
          },
        ],
      }),
    /The server assigns ids/,
  );
  assert.doesNotThrow(() =>
    validateBatch({ id: "indie", kind: "human" }, "k1", { changes: [stage("Dropped", { reason: "Lot too small" })] }),
  );
});

test("version conflict rolls the batch back, replay is idempotent, and ids are server-minted", async () => {
  const sql = await ready();
  const created = await applyBatch(sql, human, "batch-1", { changes: [stage("1 Desk screen")] });
  assert.equal(created.replayed, false);
  assert.equal(created.results[0]?.entity_id, "PIPE-PHX-0001");
  assert.equal(created.results[0]?.version, 1);
  assert.match(created.results[0]?.event_id || "", /^EV-\d{8}$/);

  await assert.rejects(
    () => applyBatch(sql, human, "batch-conflict", { changes: [stage("2 Financial screen")] }),
    (error: unknown) => {
      assert.ok(error instanceof VersionConflictError);
      assert.equal(error.status, 409);
      assert.equal(error.conflicts[0]?.actual_version, 1);
      assert.equal(error.conflicts[0]?.expected_version, 0);
      return true;
    },
  );

  await assert.rejects(() =>
    applyBatch(sql, human, "batch-rollback", {
      changes: [
        { ...stage("2 Financial screen"), expected_version: 1 },
        { ...stage("3 Site checks"), expected_version: 1 },
      ],
    }),
  );
  const row = await sql.query<{ stage: string; version: number | string }>(
    "SELECT stage, version FROM site_stages WHERE site_id = $1",
    ["PIPE-PHX-0001"],
  );
  assert.equal(row.rows[0]?.stage, "1 Desk screen");
  assert.equal(Number(row.rows[0]?.version), 1);
  const events = await sql.query<{ n: number | string }>("SELECT count(*)::int AS n FROM events");
  assert.equal(Number(events.rows[0]?.n), 1);

  const replay = await applyBatch(sql, human, "batch-1", { changes: [stage("1 Desk screen")] });
  assert.equal(replay.replayed, true);
  assert.equal(replay.results[0]?.event_id, created.results[0]?.event_id);
  assert.equal(replay.run_id, created.run_id);
  const afterReplay = await sql.query<{ n: number | string }>("SELECT count(*)::int AS n FROM events");
  assert.equal(Number(afterReplay.rows[0]?.n), 1);

  await assert.rejects(
    () => applyBatch(sql, human, "batch-1", { changes: [{ ...stage("2 Financial screen"), expected_version: 1 }] }),
    /already used for a different batch/,
  );

  const minted = await applyBatch(sql, human, "batch-mint", {
    changes: [
      {
        entity_type: "activity",
        site_id: "PIPE-PHX-0001",
        expected_version: 0,
        source: "listing note",
        payload: { date: "2026-11-01", type: "listing", summary: "Listing noted" },
      },
      {
        entity_type: "comms",
        site_id: "PIPE-LAS-0016",
        expected_version: 0,
        source: "call log",
        payload: { direction: "in", summary: "Broker left a voicemail" },
      },
    ],
  });
  assert.match(minted.results[0]?.entity_id || "", /^A-\d{6}$/);
  assert.match(minted.results[1]?.entity_id || "", /^CM-\d{4}$/);
  assert.match(minted.results[0]?.event_id || "", /^EV-\d{8}$/);
  assert.notEqual(minted.results[0]?.event_id, minted.results[1]?.event_id);
  const activity = await sql.query<{ entity_id: string }>("SELECT entity_id FROM activities");
  const comms = await sql.query<{ entity_id: string }>("SELECT entity_id FROM comms_entries");
  assert.equal(activity.rows[0]?.entity_id, minted.results[0]?.entity_id);
  assert.equal(comms.rows[0]?.entity_id, minted.results[1]?.entity_id);

  await applyBatch(sql, human, "batch-drop", {
    changes: [{ ...stage("Dropped", { reason: "Lot too small" }), expected_version: 1 }],
  });
  const dropped = await sql.query<{ stage: string; reason: string; version: number | string }>(
    "SELECT stage, reason, version FROM site_stages WHERE site_id = $1",
    ["PIPE-PHX-0001"],
  );
  assert.equal(dropped.rows[0]?.stage, "Dropped");
  assert.equal(dropped.rows[0]?.reason, "Lot too small");
  assert.equal(Number(dropped.rows[0]?.version), 2);

  await assert.rejects(() => sql.query("UPDATE events SET source = 'rewritten'"), /append-only/);
  await assert.rejects(() => sql.query("DELETE FROM events"), /append-only/);
});
