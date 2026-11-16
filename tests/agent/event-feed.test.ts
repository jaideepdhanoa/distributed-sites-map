import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { EXCLUDED_SITE_ID } from "../../lib/alerts/excluded";
import { countUnprocessedEvents, routesForEvent, syncEventFeed } from "../../lib/agent/eventFeed";
import { eventSkipKey } from "../../lib/agent/feedKeys";
import {
  DRAIN_AGENT_FEED_CONFIRM,
  assertFeedDrainApply,
  formatFeedDrain,
  runFeedDrain,
} from "../../lib/agent/feedDrain";
import { listInbox } from "../../lib/agent/inbox";
import { migrate } from "../../lib/actions/migrate";
import type { Sql } from "../../lib/actions/db";
import { memorySql } from "../helpers/sql";

const TOKEN = "SYNTHETIC-TOKEN";

async function ready(): Promise<Sql> {
  const sql = await memorySql();
  await migrate(sql);
  return sql;
}

async function insertEvent(
  sql: Sql,
  input: {
    id: string;
    type: string;
    entityId?: string;
    siteId?: string;
    payload: Record<string, unknown>;
    at: string;
    actor?: string;
    source?: string;
  },
): Promise<void> {
  await sql.query(
    `INSERT INTO events (id, entity_type, entity_id, site_id, payload, source, actor, idempotency_key, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)`,
    [
      input.id,
      input.type,
      input.entityId || input.id,
      input.siteId || "PIPE-PHX-0108",
      JSON.stringify(input.payload),
      input.source || "desk",
      input.actor || "muse",
      `evt-${input.id}`,
      input.at,
    ],
  );
}

async function sameTime(sql: Sql, key: string, iso: string): Promise<boolean> {
  const rows = await sql.query<{ same: unknown }>(
    `SELECT (created_at = $2::timestamptz) AS same FROM agent_inbox WHERE idempotency_key = $1`,
    [key, iso],
  );
  const value = rows.rows[0]?.same;
  return value === true || value === "t" || value === "true";
}

test("a projected row keeps the event created_at", async () => {
  const sql = await ready();
  const at = "2026-11-15T15:04:05.000Z";
  await insertEvent(sql, { id: "EV-00000001", type: "comms", payload: { direction: "in" }, at });
  const batch = await syncEventFeed(sql);
  assert.deepEqual(batch, { scanned: 1, projected: 1 });
  assert.equal(await sameTime(sql, "event:EV-00000001:muse", at), true);
  const shown = await listInbox(sql, {});
  assert.equal(shown.items.length, 1);
  assert.equal(shown.items[0]?.text, "Comms recorded.");
  assert.equal(await sameTime(sql, "event:EV-00000001:muse", at), true);
});

test("an event with no route gets a skip key and stays out of the feed", async () => {
  const sql = await ready();
  assert.equal(routesForEvent({ entityType: "pnl_line", source: "desk", actor: "indie", payload: { line: "labor" } }).length, 0);
  assert.equal(routesForEvent({ entityType: "activity", source: "desk", actor: "jaideep", payload: { type: "legal" } }).length, 0);
  assert.equal(routesForEvent({ entityType: "activity", source: "desk", actor: "jaideep", payload: { type: "listing" } }).length, 0);
  assert.equal(routesForEvent({ entityType: "activity", source: "desk", actor: "jaideep", payload: { type: "financials" } }).length, 0);
  assert.equal(routesForEvent({ entityType: "activity", source: "desk", actor: "jaideep", payload: { type: "stage" } }).length, 0);
  assert.equal(routesForEvent({ entityType: "stage", source: "desk", actor: "jaideep", payload: { stage: "1 Desk screen" } }).length, 1);
  assert.equal(routesForEvent({ entityType: "site", source: "desk", actor: "indie", payload: { listing_status: "live" } }).length, 1);

  await insertEvent(sql, {
    id: "EV-00000002",
    type: "pnl_line",
    payload: { line: "labor" },
    at: "2026-11-01T00:00:00.000Z",
    actor: "indie",
  });
  await insertEvent(sql, {
    id: "EV-00000003",
    type: "stage",
    siteId: EXCLUDED_SITE_ID,
    payload: { stage: "1 Desk screen" },
    at: "2026-11-01T00:00:01.000Z",
  });
  const batch = await syncEventFeed(sql);
  assert.equal(batch.scanned, 2);
  assert.equal(batch.projected, 0);
  const keys = await sql.query<{ idempotency_key: string; site_id: string }>(
    `SELECT idempotency_key, site_id FROM agent_inbox ORDER BY idempotency_key`,
  );
  assert.deepEqual(keys.rows.map((row) => row.idempotency_key), [eventSkipKey("EV-00000002"), eventSkipKey("EV-00000003")]);
  assert.equal(keys.rows.every((row) => row.site_id !== EXCLUDED_SITE_ID), true);
  assert.equal((await listInbox(sql, {})).items.length, 0);
  assert.equal(await countUnprocessedEvents(sql), 0);
  const again = await syncEventFeed(sql);
  assert.deepEqual(again, { scanned: 0, projected: 0 });
});

test("no-route events do not stall the next window", async () => {
  const sql = await ready();
  const rows = [
    { id: "EV-00000011", type: "pnl_line", payload: { line: "labor" }, at: "2026-11-01T00:00:01.000Z" },
    { id: "EV-00000012", type: "activity", payload: { type: "legal" }, at: "2026-11-01T00:00:02.000Z" },
    { id: "EV-00000013", type: "activity", payload: { type: "stage" }, at: "2026-11-01T00:00:03.000Z" },
    { id: "EV-00000014", type: "comms", payload: { direction: "in" }, at: "2026-11-15T15:04:05.000Z" },
    { id: "EV-00000015", type: "site", payload: { name: "Sample site" }, at: "2026-11-15T16:00:00.000Z", actor: "indie" },
    { id: "EV-00000016", type: "stage", payload: { stage: "2 Financial screen" }, at: "2026-11-15T17:00:00.000Z", actor: "jaideep" },
  ];
  for (const row of rows) await insertEvent(sql, row);

  const first = await syncEventFeed(sql, 2);
  assert.deepEqual(first, { scanned: 2, projected: 0 });
  assert.equal((await listInbox(sql, {})).items.length, 0);

  const second = await syncEventFeed(sql, 2);
  assert.deepEqual(second, { scanned: 2, projected: 1 });
  const mid = await listInbox(sql, {});
  assert.deepEqual(mid.items.map((item) => item.text), ["Comms recorded."]);
  assert.equal(await sameTime(sql, "event:EV-00000014:muse", "2026-11-15T15:04:05.000Z"), true);

  const third = await syncEventFeed(sql, 2);
  assert.equal(third.scanned, 2);
  assert.equal(third.projected, 2);
  const done = await listInbox(sql, {});
  assert.deepEqual(done.items.map((item) => item.text), ["Comms recorded.", "Schema updated.", "Stage updated."]);
  assert.equal(await sameTime(sql, "event:EV-00000015:indie", "2026-11-15T16:00:00.000Z"), true);
  assert.equal(await sameTime(sql, "event:EV-00000016:indie", "2026-11-15T17:00:00.000Z"), true);
  assert.equal(done.items.some((item) => item.text === "No feed route."), false);
  assert.equal(await countUnprocessedEvents(sql), 0);
  assert.deepEqual(await syncEventFeed(sql, 2), { scanned: 0, projected: 0 });
});

test("a feed read does not project events", async () => {
  const sql = await ready();
  await insertEvent(sql, {
    id: "EV-00000040",
    type: "comms",
    payload: { direction: "out", note: TOKEN },
    at: "2026-11-15T12:00:00.000Z",
  });
  const page = await listInbox(sql, { limit: 1 });
  const rest = await listInbox(sql, { after: page.next, limit: 10 });
  assert.equal(page.items.length, 0);
  assert.equal(rest.items.length, 0);
  assert.equal(await countUnprocessedEvents(sql), 1);
  const stored = await sql.query<{ n: string }>(`SELECT count(*)::text AS n FROM agent_inbox`);
  assert.equal(stored.rows[0]?.n, "0");
  assert.equal(readFileSync("lib/agent/inbox.ts", "utf8").includes("syncEventFeed"), false);
});

test("dry run counts the flood and apply resets timestamps without deleting rows", async () => {
  const sql = await ready();
  const flood = [
    { id: "EV-00000020", actor: "muse", at: "2026-11-15T15:04:05.000Z", stamped: "2026-11-16T19:00:40.000Z", audience: "muse" },
    { id: "EV-00000026", actor: "indie", at: "2026-11-14T00:00:00.000Z", stamped: "2026-11-16T19:00:41.000Z", audience: "indie" },
    { id: "EV-00000024", actor: "workbook-sync", at: "2026-11-10T00:00:00.000Z", stamped: "2026-11-16T19:00:48.500Z", audience: "indie" },
    { id: "EV-00000027", actor: "workbook-mirror", at: "2026-11-11T00:00:00.000Z", stamped: "2026-11-16T19:00:37.000Z", audience: "indie" },
    { id: "EV-00000028", actor: "jaideep", at: "2026-11-12T00:00:00.000Z", stamped: "2026-11-16T19:00:47.000Z", audience: "indie" },
  ];
  for (const row of flood) {
    await insertEvent(sql, {
      id: row.id,
      type: "comms",
      payload: { direction: "in", marker: TOKEN },
      at: row.at,
      actor: row.actor,
    });
    await sql.query(
      `INSERT INTO agent_inbox (id, kind, ref_id, site_id, actor, body, thread_key, idempotency_key, created_at, audience)
       VALUES ($1, 'data_change', 'PIPE-PHX-0108', 'PIPE-PHX-0108', $2, 'Schema updated.', $3, $4, $5, $6)`,
      [`row-${row.id}`, row.actor, `event:${row.id}`, `event:${row.id}:${row.audience}`, row.stamped, row.audience],
    );
  }
  await insertEvent(sql, { id: "EV-00000021", type: "comms", payload: { direction: "in" }, at: "2026-11-01T00:00:00.000Z" });
  await sql.query(
    `INSERT INTO agent_inbox (id, kind, ref_id, site_id, actor, body, thread_key, idempotency_key, created_at, audience)
     VALUES ('row-early', 'data_change', 'PIPE-PHX-0108', 'PIPE-PHX-0108', 'muse', 'Schema updated.', 'event:EV-00000021', 'event:EV-00000021:muse', '2026-11-16T19:00:36.000Z', 'muse')`,
  );
  await insertEvent(sql, { id: "EV-00000022", type: "comms", payload: { direction: "in" }, at: "2026-11-02T00:00:00.000Z", actor: "cindel" });
  await sql.query(
    `INSERT INTO agent_inbox (id, kind, ref_id, site_id, actor, body, thread_key, idempotency_key, created_at, audience)
     VALUES ('row-other', 'data_change', 'PIPE-PHX-0108', 'PIPE-PHX-0108', 'cindel', 'Schema updated.', 'event:EV-00000022', 'event:EV-00000022:muse', '2026-11-16T19:00:41.000Z', 'muse')`,
  );
  await insertEvent(sql, { id: "EV-00000023", type: "comms", payload: { direction: "in" }, at: "2026-11-16T19:00:42.000Z", actor: "indie" });
  await sql.query(
    `INSERT INTO agent_inbox (id, kind, ref_id, site_id, actor, body, thread_key, idempotency_key, created_at, audience)
     VALUES ('row-same', 'data_change', 'PIPE-PHX-0108', 'PIPE-PHX-0108', 'indie', 'Schema updated.', 'event:EV-00000023', 'event:EV-00000023:indie', '2026-11-16T19:00:42.000Z', 'indie')`,
  );
  await insertEvent(sql, { id: "EV-00000025", type: "comms", payload: { direction: "in" }, at: "2026-11-09T00:00:00.000Z", actor: "jaideep" });
  await sql.query(
    `INSERT INTO agent_inbox (id, kind, ref_id, site_id, actor, body, thread_key, idempotency_key, created_at, audience)
     VALUES ('row-late', 'data_change', 'PIPE-PHX-0108', 'PIPE-PHX-0108', 'jaideep', 'Schema updated.', 'event:EV-00000025', 'event:EV-00000025:indie', '2026-11-16T19:00:49.000Z', 'indie')`,
  );
  await insertEvent(sql, { id: "EV-00000029", type: "pnl_line", payload: { line: "labor", marker: TOKEN }, at: "2026-11-08T00:00:00.000Z", actor: "muse" });
  await sql.query(
    `INSERT INTO agent_inbox (id, kind, subtype, ref_id, site_id, actor, body, thread_key, idempotency_key, created_at)
     VALUES ('row-skip', 'data_change', 'skip', 'EV-00000029', 'portfolio', 'muse', 'No feed route.', 'event:EV-00000029', 'event:EV-00000029:skip', '2026-11-16T19:00:44.000Z')`,
  );
  await insertEvent(sql, {
    id: "EV-00000030",
    type: "comms",
    payload: { direction: "out", marker: TOKEN },
    at: "2026-11-03T08:00:00.000Z",
  });

  const before = await sql.query<{ n: string }>(`SELECT count(*)::text AS n FROM agent_inbox`);
  const preview = await runFeedDrain(sql, { apply: false });
  assert.equal(preview.mode, "dry-run");
  assert.equal(preview.timestampsReset, 0);
  assert.equal(preview.projected, 0);
  assert.equal(preview.scanned, 0);
  assert.equal(preview.timestampsToReset, 5);
  assert.equal(preview.floodRows, 6);
  assert.equal(preview.unprocessed, 1);
  const printed = formatFeedDrain(preview);
  assert.equal(printed.includes(TOKEN), false);
  assert.equal(printed.includes("PIPE-PHX"), false);
  assert.equal(await sameTime(sql, "event:EV-00000020:muse", "2026-11-16T19:00:40.000Z"), true);
  const still = await sql.query<{ n: string }>(`SELECT count(*)::text AS n FROM agent_inbox`);
  assert.equal(still.rows[0]?.n, before.rows[0]?.n);

  await assert.rejects(() => runFeedDrain(sql, { apply: true, confirm: "" }), /CONFIRM|confirm phrase/);
  await assert.rejects(() => runFeedDrain(sql, { apply: true, confirm: "drain-agent" }), /CONFIRM|confirm phrase/);
  assert.equal(await sameTime(sql, "event:EV-00000020:muse", "2026-11-16T19:00:40.000Z"), true);

  const applied = await runFeedDrain(sql, { apply: true, confirm: DRAIN_AGENT_FEED_CONFIRM });
  assert.equal(applied.timestampsReset, 5);
  assert.equal(applied.projected, 1);
  assert.equal(applied.unprocessedAfter, 0);
  assert.equal(printed.includes(TOKEN) || formatFeedDrain(applied).includes(TOKEN), false);
  const after = await sql.query<{ n: string }>(`SELECT count(*)::text AS n FROM agent_inbox`);
  assert.equal(Number(after.rows[0]?.n), Number(before.rows[0]?.n) + 1);
  assert.equal(await sameTime(sql, "event:EV-00000020:muse", "2026-11-15T15:04:05.000Z"), true);
  assert.equal(await sameTime(sql, "event:EV-00000026:indie", "2026-11-14T00:00:00.000Z"), true);
  assert.equal(await sameTime(sql, "event:EV-00000024:indie", "2026-11-10T00:00:00.000Z"), true);
  assert.equal(await sameTime(sql, "event:EV-00000027:indie", "2026-11-11T00:00:00.000Z"), true);
  assert.equal(await sameTime(sql, "event:EV-00000028:indie", "2026-11-12T00:00:00.000Z"), true);
  assert.equal(await sameTime(sql, "event:EV-00000021:muse", "2026-11-16T19:00:36.000Z"), true);
  assert.equal(await sameTime(sql, "event:EV-00000022:muse", "2026-11-16T19:00:41.000Z"), true);
  assert.equal(await sameTime(sql, "event:EV-00000023:indie", "2026-11-16T19:00:42.000Z"), true);
  assert.equal(await sameTime(sql, "event:EV-00000025:indie", "2026-11-16T19:00:49.000Z"), true);
  assert.equal(await sameTime(sql, "event:EV-00000029:skip", "2026-11-16T19:00:44.000Z"), true);
  assert.equal(await sameTime(sql, "event:EV-00000030:muse", "2026-11-03T08:00:00.000Z"), true);
  const visible = await listInbox(sql, {});
  assert.equal(visible.items.some((item) => item.refId === "EV-00000030" || item.text === "Comms recorded."), true);
  assert.equal(visible.items.some((item) => item.text === "No feed route."), false);

  const second = await runFeedDrain(sql, { apply: true, confirm: DRAIN_AGENT_FEED_CONFIRM });
  assert.equal(second.timestampsReset, 0);
  assert.equal(second.projected, 0);
  assert.equal(second.unprocessedAfter, 0);
});

test("the drain workflow is manual, dry-run by default, and confirm-gated", () => {
  const source = readFileSync(".github/workflows/drain-agent-feed.yml", "utf8");
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /dry_run:/);
  assert.match(source, /default: true/);
  assert.match(source, /confirm:/);
  assert.match(source, /drain-agent-feed/);
  assert.doesNotMatch(source, /schedule:/);
  const script = readFileSync("scripts/drain-agent-feed.ts", "utf8");
  assert.match(script, /formatFeedDrain/);
  assert.match(script, /Nothing was written/);
  assert.match(script, /assertFeedDrainApply/);
});

test("a preview and an unconfirmed production write are refused", () => {
  const saved = {
    vercel: process.env.VERCEL_ENV,
    ci: process.env.CI,
    actions: process.env.GITHUB_ACTIONS,
    event: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
    allow: process.env.ALLOW_DRAIN_AGENT_FEED,
    host: process.env.NEON_PRODUCTION_HOST,
    neon: process.env.NEON_DATABASE_URL,
  };
  try {
    process.env.VERCEL_ENV = "preview";
    assert.throws(() => assertFeedDrainApply("postgres://example", DRAIN_AGENT_FEED_CONFIRM), /Vercel/);
    delete process.env.VERCEL_ENV;
    process.env.CI = "true";
    assert.throws(() => assertFeedDrainApply("postgres://example", DRAIN_AGENT_FEED_CONFIRM), /CI/);
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;
    process.env.NEON_PRODUCTION_HOST = "prod.example";
    assert.throws(
      () => assertFeedDrainApply("postgres://prod.example/db", DRAIN_AGENT_FEED_CONFIRM),
      /production database/,
    );
    assert.throws(() => assertFeedDrainApply("postgres://other.example/db", "nope"), /CONFIRM/);
  } finally {
    const names = {
      vercel: "VERCEL_ENV",
      ci: "CI",
      actions: "GITHUB_ACTIONS",
      event: "GITHUB_EVENT_NAME",
      ref: "GITHUB_REF",
      allow: "ALLOW_DRAIN_AGENT_FEED",
      host: "NEON_PRODUCTION_HOST",
      neon: "NEON_DATABASE_URL",
    } as const;
    for (const [key, name] of Object.entries(names)) {
      const value = saved[key as keyof typeof saved];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
