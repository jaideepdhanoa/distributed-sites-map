import assert from "node:assert/strict";
import test from "node:test";
import { audit, listAudit, listAuditStageEvents, parseAuditTarget, readAuditStage } from "../../lib/actions/audit";
import { migrate } from "../../lib/actions/migrate";
import { InputError } from "../../lib/actions/text";
import { EXCLUDED_SITE_ID } from "../../lib/alerts/excluded";
import { memorySql } from "../helpers/sql";

const siteId = "PIPE-LAS-9001";

test("audit scope requires one valid target pair and refuses protected records", () => {
  assert.equal(parseAuditTarget(new URLSearchParams()), undefined);
  assert.deepEqual(parseAuditTarget(new URLSearchParams({ targetKind: "deal", targetId: siteId })), {
    targetKind: "deal", targetId: siteId,
  });
  for (const query of [
    "targetKind=deal", "targetId=PIPE-LAS-9001", "targetKind=&targetId=", "targetKind=deal&targetId=",
    "targetKind=other&targetId=PIPE-LAS-9001", "targetKind=deal&targetId=invalid%2Fid",
    "targetKind=deal&targetKind=site&targetId=PIPE-LAS-9001",
    "targetKind=deal&targetId=PIPE-LAS-9001&targetId=PIPE-LAS-9002",
  ]) {
    assert.throws(() => parseAuditTarget(new URLSearchParams(query)), (error) => error instanceof InputError && error.status === 400);
  }
  assert.throws(
    () => parseAuditTarget(new URLSearchParams({ targetKind: "deal", targetId: EXCLUDED_SITE_ID })),
    (error) => error instanceof InputError && error.status === 404,
  );
});

test("audit filtering matches both target kind and id before applying the limit", async () => {
  const sql = await memorySql();
  await migrate(sql);
  await audit(sql, { actorId: "reviewer", action: "suggestion.create", targetKind: "deal", targetId: siteId, after: { id: "proposal-a", status: "open" } });
  await audit(sql, { actorId: "reviewer", action: "suggestion.close", targetKind: "deal", targetId: siteId, before: { id: "proposal-a", status: "open" }, after: { id: "proposal-a", status: "superseded" } });
  await audit(sql, { actorId: "reviewer", action: "suggestion.accept", targetKind: "site", targetId: siteId });
  await audit(sql, { actorId: "reviewer", action: "suggestion.accept", targetKind: "deal", targetId: "PIPE-LAS-9002" });
  await audit(sql, { actorId: "system", action: "export" });

  const target = { targetKind: "deal" as const, targetId: siteId };
  const scoped = await listAudit(sql, 100, target);
  assert.deepEqual(scoped.map((row) => row.action), ["suggestion.close", "suggestion.create"]);
  assert.deepEqual(scoped[0].before, { id: "proposal-a", status: "open" });
  assert.deepEqual(scoped[0].after, { id: "proposal-a", status: "superseded" });
  assert.equal((await listAudit(sql, 1, target))[0]?.action, "suggestion.close");
  assert.equal((await listAudit(sql)).length, 5);
  assert.deepEqual(await listAudit(sql, 100, { targetKind: "deal", targetId: "PIPE-LAS-9003" }), []);
});

test("scoped stage diagnostics return the current stored row without reasons or snapshot fallback", async () => {
  const sql = await memorySql();
  await migrate(sql);
  await sql.query(
    `INSERT INTO site_stages (site_id, market, stage, reason, version, updated_by, updated_at)
     VALUES ($1, 'LAS', '2 Financial screen', 'Private sample justification', 7, 'reviewer', '2026-11-01T12:00:00-08:00')`,
    [siteId],
  );
  assert.deepEqual(await readAuditStage(sql, siteId), {
    siteId, stage: "2 Financial screen", version: 7, updatedBy: "reviewer", updatedAt: "2026-11-01T20:00:00.000+00:00",
  });
  assert.equal(await readAuditStage(sql, "PIPE-LAS-9002"), null);
  assert.equal(await readAuditStage(sql, "WB-LAS-9001"), null);
  assert.equal(await readAuditStage(sql, EXCLUDED_SITE_ID), null);
});

test("stage event diagnostics include only the requested site's stage writes and selected fields", async () => {
  const sql = await memorySql();
  await migrate(sql);
  await sql.query(
    `INSERT INTO events (id, entity_type, entity_id, site_id, payload, source, actor, idempotency_key, created_at)
     VALUES
       ('EV-AUDIT-1', 'stage', $1, $1, '{"stage":"1 Desk screen","previous_stage":null,"reason":"Private sample justification"}', 'Sample initial stage', 'reviewer', 'audit-initial-key', '2026-11-01T12:00:00-08:00'),
       ('EV-AUDIT-2', 'stage', $1, $1, '{"stage":"2 Financial screen","previous_stage":"1 Desk screen","reason":"Private sample justification"}', 'Accepted stage decision', 'reviewer', 'audit-accepted-key', '2026-11-02T12:00:00-08:00'),
       ('EV-AUDIT-3', 'stage', 'PIPE-LAS-9002', 'PIPE-LAS-9002', '{"stage":"3 Site checks"}', 'Other sample site', 'reviewer', 'audit-other-key', '2026-11-03T12:00:00-08:00'),
       ('EV-AUDIT-4', 'activity', 'A-AUDIT-1', $1, '{"stage":"Dropped","summary":"Private sample activity"}', 'Sample activity', 'reviewer', 'audit-activity-key', '2026-11-04T12:00:00-08:00')`,
    [siteId],
  );
  assert.deepEqual(await listAuditStageEvents(sql, siteId), [
    {
      id: "EV-AUDIT-2", stage: "2 Financial screen", previousStage: "1 Desk screen",
      actor: "reviewer", source: "Accepted stage decision", createdAt: "2026-11-02T20:00:00.000+00:00",
    },
    {
      id: "EV-AUDIT-1", stage: "1 Desk screen", previousStage: null,
      actor: "reviewer", source: "Sample initial stage", createdAt: "2026-11-01T20:00:00.000+00:00",
    },
  ]);
  assert.deepEqual(await listAuditStageEvents(sql, "PIPE-LAS-9003"), []);
  assert.deepEqual(await listAuditStageEvents(sql, EXCLUDED_SITE_ID), []);
});
