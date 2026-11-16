import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { EXCLUDED_SITE_ID } from "../../lib/alerts/excluded";
import { applyBatch, VersionConflictError } from "../../lib/changes/apply";
import { validateBatch, type Actor } from "../../lib/changes/schema";
import { listSiteSpaces } from "../../lib/spaces/store";
import { memorySql } from "../helpers/sql";

const contributor: Actor = { id: "contributor", kind: "human", role: "contributor" };
const viewer: Actor = { id: "viewer", kind: "human", role: "viewer" };
const muse: Actor = { id: "muse", kind: "agent" };

const ISO_OFFSET = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}[+-][0-9]{2}:[0-9]{2}$/;

function space(payload: Record<string, unknown> = {}, change: Record<string, unknown> = {}) {
  return {
    entity_type: "site_space",
    site_id: "PIPE-LAS-9001",
    expected_version: 0,
    source: "Site aerial",
    ...change,
    payload: {
      center_lng: -115.1391,
      center_lat: 36.1699,
      length_ft: 90,
      width_ft: 60,
      rotation_deg: 15,
      type: "excess_parking",
      layout: "stalls_90",
      ...payload,
    },
  };
}

async function ready() {
  const sql = await memorySql();
  await migrate(sql);
  return sql;
}

test("a signed-in person can mark a space and an agent cannot", () => {
  assert.doesNotThrow(() => validateBatch(viewer, "k1", { changes: [space()] }));
  assert.doesNotThrow(() => validateBatch(contributor, "k1", { changes: [space({}, { site_id: "PHX-U189" })] }));
  assert.throws(() => validateBatch(muse, "k1", { changes: [space()] }), /person marks a space/);
  assert.throws(() => validateBatch(viewer, "k1", { changes: [space({}, { site_id: EXCLUDED_SITE_ID })] }), /not written here/);
  assert.throws(() => validateBatch(viewer, "k1", { changes: [space({ type: "driveway" })] }), /not valid/);
  assert.throws(() => validateBatch(viewer, "k1", { changes: [space({ length_ft: 2 })] }), /4 and 2,000/);
  assert.throws(() => validateBatch(viewer, "k1", { changes: [space({ center_lat: 0, center_lng: 0 })] }), /outside the mapped markets/);
  assert.throws(() => validateBatch(viewer, "k1", { changes: [{ ...space(), payload: { deleted: true } }] }), /cannot be deleted/);
});

test("a space stores geodesic size, an estimated count, the author, and an offset timestamp", async () => {
  const sql = await ready();
  const created = await applyBatch(sql, viewer, "space-1", { changes: [space()] });
  assert.equal(created.results[0]?.entity_type, "site_space");
  assert.match(created.results[0]?.entity_id || "", /^SS-\d{6}$/);
  assert.equal(created.results[0]?.version, 1);
  const rows = await listSiteSpaces(sql, "PIPE-LAS-9001");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.estSlots, 20);
  assert.equal(rows[0]?.status, "estimated");
  assert.equal(rows[0]?.author, "viewer");
  assert.equal(rows[0]?.updatedBy, "viewer");
  assert.match(rows[0]?.createdAt || "", ISO_OFFSET);
  assert.match(rows[0]?.updatedAt || "", ISO_OFFSET);
  assert.equal(rows[0]?.polygon.type, "Polygon");
  assert.equal(rows[0]?.polygon.coordinates[0]?.length, 5);
  const event = await sql.query<{ actor: string; payload: { est_slots: number; created_at: string; status: string } }>(
    `SELECT actor, payload FROM events WHERE entity_type = 'site_space' AND entity_id = $1`,
    [created.results[0]?.entity_id],
  );
  assert.equal(event.rows[0]?.actor, "viewer");
  assert.equal(event.rows[0]?.payload.est_slots, 20);
  assert.equal(event.rows[0]?.payload.status, "estimated");
  assert.match(event.rows[0]?.payload.created_at || "", ISO_OFFSET);

  const updated = await applyBatch(sql, contributor, "space-2", {
    changes: [{
      ...space({ layout: "pull_through", type: "vacuum_row" }),
      entity_id: created.results[0]?.entity_id,
      expected_version: 1,
    }],
  });
  assert.equal(updated.results[0]?.version, 2);
  const next = await listSiteSpaces(sql, "PIPE-LAS-9001");
  assert.equal(next[0]?.layout, "pull_through");
  assert.equal(next[0]?.type, "vacuum_row");
  assert.equal(next[0]?.estSlots, 7);
  assert.equal(next[0]?.author, "viewer");
  assert.equal(next[0]?.updatedBy, "contributor");

  await assert.rejects(
    () => applyBatch(sql, contributor, "space-stale", {
      changes: [{ ...space(), entity_id: created.results[0]?.entity_id, expected_version: 1 }],
    }),
    (error: unknown) => error instanceof VersionConflictError,
  );

  await applyBatch(sql, contributor, "space-delete", {
    changes: [{
      entity_type: "site_space",
      site_id: "PIPE-LAS-9001",
      entity_id: created.results[0]?.entity_id,
      expected_version: 2,
      source: "Site aerial",
      payload: { deleted: true },
    }],
  });
  assert.equal((await listSiteSpaces(sql, "PIPE-LAS-9001")).length, 0);
  const kept = await sql.query<{ author: string; version: number | string }>(
    `SELECT author, version FROM site_spaces WHERE id = $1`,
    [created.results[0]?.entity_id],
  );
  assert.equal(kept.rows[0]?.author, "viewer");
  assert.equal(Number(kept.rows[0]?.version), 3);
});
