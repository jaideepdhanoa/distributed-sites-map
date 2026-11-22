import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { applyBatch } from "../../lib/changes/apply";
import { validateBatch, type Actor } from "../../lib/changes/schema";
import { memorySql } from "../helpers/sql";

const contributor: Actor = { id: "cindel", kind: "human", role: "contributor" };
const viewer: Actor = { id: "guest", kind: "human", role: "viewer" };
const AT = "2026-11-20T15:00:00Z";

function body(payload: Record<string, unknown>, expected = 0) {
  return {
    changes: [{
      entity_type: "nda",
      site_id: "NDA-001",
      expected_version: expected,
      source: "NDA queue",
      payload,
    }],
  };
}

test("a contributor records a status note and an owner on an NDA", async () => {
  const sql = await memorySql();
  await migrate(sql);
  assert.throws(() => validateBatch(viewer, "nda-view", body({ action: "status", status: "Executed", note: "Done.", at: AT })));
  assert.throws(() => validateBatch(contributor, "nda-blank", body({ action: "status", status: "Executed", note: "", at: AT })));
  const applied = await applyBatch(sql, contributor, "nda-status", body({
    action: "status",
    status: "With Moove legal",
    waiting_on: "Us — legal",
    note: "Sent to legal.",
    at: AT,
  }));
  assert.equal(applied.results[0]?.version, 1);
  assert.equal(applied.results[0]?.entity_type, "nda");
  const state = await sql.query<{ status: string; version: number | string }>(
    `SELECT status, version FROM nda_state WHERE nda_id = 'NDA-001'`,
  );
  assert.equal(state.rows[0]?.status, "With Moove legal");
  const history = await sql.query<{ note: string; actor: string }>(
    `SELECT note, actor FROM nda_history WHERE nda_id = 'NDA-001'`,
  );
  assert.equal(history.rows[0]?.note, "Sent to legal.");
  assert.equal(history.rows[0]?.actor, "cindel");
  const events = await sql.query<{ entity_type: string }>(
    `SELECT entity_type FROM events WHERE site_id = 'NDA-001'`,
  );
  assert.equal(events.rows[0]?.entity_type, "nda");
  const owned = await applyBatch(sql, contributor, "nda-owner", body({ action: "assign", owner: "cindel", at: AT }, 1));
  assert.equal(owned.results[0]?.version, 2);
  const after = await sql.query<{ owner: string; status: string }>(
    `SELECT owner, status FROM nda_state WHERE nda_id = 'NDA-001'`,
  );
  assert.equal(after.rows[0]?.owner, "cindel");
  assert.equal(after.rows[0]?.status, "With Moove legal");
});
