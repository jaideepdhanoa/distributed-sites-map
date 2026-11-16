import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { applyBatch, VersionConflictError } from "../../lib/changes/apply";
import { formatZonedTimestamp, validateBatch, type Actor } from "../../lib/changes/schema";
import { memorySql } from "../helpers/sql";

const reviewer: Actor = { id: "ada", kind: "human", role: "reviewer" };
const contributor: Actor = { id: "bea", kind: "human", role: "contributor" };
const muse: Actor = { id: "muse", kind: "agent" };
const indie: Actor = { id: "indie", kind: "agent" };

function tag(family: string, code: string, extra: Record<string, unknown> = {}, version = 0) {
  return {
    entity_type: "tag" as const,
    site_id: "PIPE-PHX-0107",
    expected_version: version,
    source: "desk review",
    payload: { family, code, ...extra },
  };
}

test("owning roles decide who can write a chip", () => {
  assert.throws(() => validateBatch(indie, "indie-wait", { changes: [tag("waiting_on", "broker_reply")] }), /owned by another role/);
  assert.throws(() => validateBatch(muse, "muse-drop", { changes: [tag("drop_reason", "duplicate")] }), /person decides/);
  assert.throws(() => validateBatch(contributor, "contributor-drop", { changes: [tag("drop_reason", "duplicate")] }), /owned by another role/);
  assert.throws(() => validateBatch(muse, "muse-photo", { changes: [tag("photos", "partial")] }), /owned by another role/);
  assert.doesNotThrow(() => validateBatch(muse, "muse-wait", { changes: [tag("waiting_on", "we_owe", { since: "2026-11-16T09:00:00-07:00" })] }));
  assert.doesNotThrow(() => validateBatch(indie, "indie-photo", { changes: [tag("photos", "partial")] }));
  assert.doesNotThrow(() => validateBatch(indie, "indie-check", { changes: [tag("diligence_power", "verified")] }));
  assert.doesNotThrow(() => validateBatch(muse, "muse-check", { changes: [tag("diligence_land", "estimated")] }));
  assert.doesNotThrow(() => validateBatch(reviewer, "human-drop", { changes: [tag("drop_reason", "price_vs_value")] }));
  assert.throws(() => validateBatch(reviewer, "bare-since", { changes: [tag("waiting_on", "nothing", { since: "2026-11-16" })] }), /ISO-8601/);
});

test("a tag write stores the version, the event, and the offset timestamp", async () => {
  const sql = await memorySql();
  await migrate(sql);
  const since = formatZonedTimestamp(new Date("2026-11-16T16:00:00.000Z"));
  const applied = await applyBatch(sql, muse, "tag-one", { changes: [tag("waiting_on", "broker_reply", { since, source_ref: "stage_blocker", note: "Waiting on a reply." })] });
  assert.equal(applied.results[0]?.entity_type, "tag");
  assert.equal(applied.results[0]?.version, 1);
  const row = await sql.query<{ code: string; since_iso: string; version: number | string; actor: string }>(
    `SELECT code, since_iso, version, actor FROM site_tags WHERE site_id = 'PIPE-PHX-0107' AND family = 'waiting_on'`,
  );
  assert.equal(row.rows[0]?.code, "broker_reply");
  assert.equal(row.rows[0]?.since_iso, since);
  assert.match(row.rows[0]?.since_iso || "", /[+-]\d{2}:\d{2}$/);
  assert.equal(row.rows[0]?.actor, "muse");
  const event = await sql.query<{ entity_type: string }>(
    `SELECT entity_type FROM events WHERE entity_type = 'tag' AND site_id = 'PIPE-PHX-0107'`,
  );
  assert.equal(event.rows.length, 1);
  await assert.rejects(() => applyBatch(sql, muse, "tag-stale", { changes: [tag("waiting_on", "we_owe")] }), VersionConflictError);
  const second = await applyBatch(sql, reviewer, "tag-two", { changes: [tag("waiting_on", "we_owe", {}, 1)] });
  assert.equal(second.results[0]?.version, 2);
});

test("Dropped still needs a human actor and a reason in the database", async () => {
  const sql = await memorySql();
  await migrate(sql);
  await assert.rejects(
    () => sql.query(
      `INSERT INTO site_stages (site_id, market, stage, reason, version, updated_by) VALUES ('PIPE-PHX-0108', 'PHX', 'Dropped', '', 1, 'ada')`,
    ),
    /Dropped needs a reason/,
  );
  await assert.rejects(
    () => sql.query(
      `INSERT INTO site_stages (site_id, market, stage, reason, version, updated_by) VALUES ('PIPE-PHX-0108', 'PHX', 'Dropped', 'Lot too small', 1, 'muse')`,
    ),
    /Dropped needs a human actor/,
  );
  await sql.query(
    `INSERT INTO site_stages (site_id, market, stage, reason, version, updated_by) VALUES ('PIPE-PHX-0108', 'PHX', 'Dropped', 'Lot too small', 1, 'ada')`,
  );
  const row = await sql.query<{ stage: string }>(`SELECT stage FROM site_stages WHERE site_id = 'PIPE-PHX-0108'`);
  assert.equal(row.rows[0]?.stage, "Dropped");
});
