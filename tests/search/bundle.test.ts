import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { applyBatch } from "../../lib/changes/apply";
import { planActivityMirror, type SheetTable } from "../../lib/changes/mirror";
import { validateBatch, type Actor } from "../../lib/changes/schema";
import { authorizeAgent } from "../../lib/agent/auth";
import { ackInbox, listInbox } from "../../lib/agent/inbox";
import { canonicalUrl, feedSitePath } from "../../lib/agent/links";
import { brokerMatchFeed, routesForEvent, sweepStale } from "../../lib/agent/eventFeed";
import { insertFeedRow } from "../../lib/agent/inbox";
import { runAskTool } from "../../lib/ask/tools";
import { backfillDecision } from "../../lib/search/backfill";
import { draftsForRecord, scrub } from "../../lib/search/docs";
import { searchDocs } from "../../lib/search/query";
import { reciprocalRankFusion, withExactWins } from "../../lib/search/rank";
import { memorySql } from "../helpers/sql";
import { POST as ackRoute } from "../../lib/api/handlers/agent/inbox-ack";

const human: Actor = { id: "jaideep", kind: "human", role: "reviewer" };
const ISO = "2026-11-15T18:20:00-08:00";

function table(headers: string[], body: string[][]): SheetTable {
  return { title: "Activity", headerRow: 1, headers, rows: body.map((cells, index) => ({ row: index + 2, cells })) };
}

async function ready() {
  const sql = await memorySql();
  await migrate(sql);
  return sql;
}

test("reciprocal rank fusion lets an exact id beat a semantic neighbor", () => {
  const fused = withExactWins(
    reciprocalRankFusion([
      ["vector-only", "exact-id"],
      ["exact-id"],
    ]),
    ["exact-id"],
  );
  assert.equal(fused[0]?.id, "exact-id");
  assert.ok((fused[0]?.score || 0) > (fused[1]?.score || 0));
});

test("canonical links stay on the production host and skip the quarantined site", () => {
  assert.equal(feedSitePath("note", "PIPE-PHX-0008"), "https://distributedsites.com/?site=PIPE-PHX-0008&panel=discussion");
  assert.equal(canonicalUrl({ siteId: "PIPE-PHX-0008", panel: "activity", msg: "CM-0123" }), "https://distributedsites.com/?site=PIPE-PHX-0008&panel=activity&msg=CM-0123");
  assert.equal(canonicalUrl({ siteId: "PIPE-PHX-0008", panel: "financials", pl: "monthly" }), "https://distributedsites.com/?site=PIPE-PHX-0008&panel=financials&pl=monthly");
  assert.equal(canonicalUrl({ siteId: "PIPE-PHX-0006", panel: "activity" }), "");
  assert.equal(feedSitePath("note", "PIPE-PHX-0008").includes("preview"), false);
});

test("search text drops mailbox addresses and the quarantined site", () => {
  assert.equal(scrub("Desk note person@example.com"), "Desk note");
  assert.equal(draftsForRecord({
    entityType: "site",
    entityId: "PIPE-PHX-0006",
    siteId: "PIPE-PHX-0006",
    payload: { name: "Hidden", address: "Secret", apn: "1" },
  }).length, 0);
  const broker = draftsForRecord({
    entityType: "site",
    entityId: "PIPE-PHX-0108",
    siteId: "PIPE-PHX-0108",
    payload: { name: "North Sample", broker: "Sample Broker", firm: "Sample Firm", asking_price: "9" },
  });
  assert.equal(broker.some((row) => row.docType === "broker" && row.title === "Sample Broker"), true);
  assert.equal(JSON.stringify(broker).includes("9"), false);
});

test("comms ids are stored on the row for create and update, and gmail ids stay out of the payload", async () => {
  const sql = await ready();
  assert.throws(
    () => validateBatch(human, "bad-gmail", { changes: [comms({ gmail_message_id: "not-an-id" })] }),
    /16 hex characters/,
  );
  const cleaned = validateBatch(human, "clean-link", {
    changes: [comms({ link: "https://mail.google.com/mail/u/0/#inbox/abcdef0123456789?authuser=person@example.com" })],
  });
  const cleanedLink = (cleaned.changes[0]?.payload as { link?: string }).link || "";
  assert.equal(cleanedLink.includes("@"), false);
  assert.equal(cleanedLink.includes("authuser"), false);
  assert.match(cleanedLink, /^https:\/\/mail\.google\.com\/mail\/u\/0\/#inbox\/abcdef0123456789$/);
  const created = await applyBatch(sql, human, "comms-create", {
    changes: [comms({
      message_id: "abcdef0123456789",
      thread_id: "abcdef0123456789",
      link: "https://example.com/note",
      gmail_message_id: "0123456789abcdef",
      gmail_thread_id: "fedcba9876543210",
    })],
  });
  const id = created.results[0]?.entity_id || "";
  const row = await sql.query<{ message_id: string; thread_id: string; link: string; gmail_message_id: string; payload: { message_id?: string; gmail_message_id?: string; link?: string } }>(
    `SELECT message_id, thread_id, link, gmail_message_id, payload FROM comms_entries WHERE entity_id = $1`,
    [id],
  );
  assert.equal(row.rows[0]?.message_id, "abcdef0123456789");
  assert.equal(row.rows[0]?.thread_id, "abcdef0123456789");
  assert.equal(row.rows[0]?.link, "https://example.com/note");
  assert.equal(row.rows[0]?.gmail_message_id, "0123456789abcdef");
  assert.equal(row.rows[0]?.payload.message_id, "abcdef0123456789");
  assert.equal(row.rows[0]?.payload.gmail_message_id, undefined);
  const event = await sql.query<{ payload: { gmail_message_id?: string; message_id?: string } }>(
    `SELECT payload FROM events WHERE entity_id = $1`,
    [id],
  );
  assert.equal(event.rows[0]?.payload.gmail_message_id, undefined);
  assert.equal(event.rows[0]?.payload.message_id, "abcdef0123456789");
  await applyBatch(sql, human, "comms-update", {
    changes: [{
      entity_type: "comms",
      site_id: "PIPE-PHX-0001",
      entity_id: id,
      expected_version: 1,
      source: "desk",
      payload: { direction: "out", message_id: "1234567890abcdef", thread_id: "1234567890abcdef", link: "https://example.com/next" },
    }],
  });
  const next = await sql.query<{ message_id: string; link: string; gmail_message_id: string }>(
    `SELECT message_id, link, gmail_message_id FROM comms_entries WHERE entity_id = $1`,
    [id],
  );
  assert.equal(next.rows[0]?.message_id, "1234567890abcdef");
  assert.equal(next.rows[0]?.link, "https://example.com/next");
  assert.equal(next.rows[0]?.gmail_message_id, "0123456789abcdef");
});

test("an approximate activity accepts a calendar day and a zoned time still requires an offset", async () => {
  assert.throws(() => validateBatch(human, "bare", { changes: [activity("2026-11-15")] }), /ISO-8601 time with a zone offset/);
  const loose = validateBatch(human, "approx", { changes: [activity("2026-11-15", true)] });
  assert.equal((loose.changes[0]?.payload as { at_approximate?: boolean }).at_approximate, true);
  const exact = validateBatch(human, "zoned-approx", { changes: [activity(ISO, true)] });
  const payload = exact.changes[0]?.payload as { date: string; date_iso?: string; at_approximate?: boolean };
  assert.equal(payload.date, "2026-11-15");
  assert.equal(payload.date_iso, ISO);
  assert.equal(payload.at_approximate, true);
  const sql = await ready();
  await applyBatch(sql, human, "activity-approx", { changes: [activity(ISO, true)] });
  const row = await sql.query<{ at_approximate: boolean; payload: { at_approximate?: boolean } }>(
    `SELECT at_approximate, payload FROM activities`,
  );
  assert.equal(row.rows[0]?.at_approximate, true);
  assert.equal(row.rows[0]?.payload.at_approximate, true);
});

test("an approximate activity mirrors the same way as comms", () => {
  const sheet = table(["Event ID", "Date"], [["A-000001", "2026-11-15 18:20"]]);
  const plan = planActivityMirror(sheet, [{
    entity_id: "A-000001",
    site_id: "PIPE-PHX-0001",
    date: "2026-11-15",
    date_iso: ISO,
    at_approximate: true,
    type: "listing",
    summary: "Noted",
    source_link: "",
  }]);
  assert.equal(plan.changes[0]?.after, `${ISO} (approx.)`);
});

test("full-text search works when no embedding is stored", async () => {
  const sql = await ready();
  await applyBatch(sql, human, "index-site", {
    changes: [{
      entity_type: "site",
      site_id: "PIPE-PHX-0108",
      expected_version: 0,
      source: "desk",
      payload: { name: "North Sample Wash", address: "1 Sample Road", market: "PHX", category: "Car wash" },
    }],
  });
  const hits = await searchDocs(sql, { query: "North Sample", visibility: ["public", "signed-in"] });
  assert.equal(hits.some((hit) => hit.title === "North Sample Wash"), true);
  assert.equal(hits.every((hit) => hit.url.startsWith("https://distributedsites.com/")), true);
  const hidden = await searchDocs(sql, { query: "North Sample", visibility: ["public"] });
  assert.equal(hidden.length, 0);
});

test("feed routes and indie cannot acknowledge", async () => {
  assert.deepEqual(
    routesForEvent({ entityType: "comms", source: "desk", actor: "muse", payload: { direction: "in" } }).map((row) => row.audience),
    ["muse"],
  );
  const indie = routesForEvent({
    entityType: "site",
    source: "schema",
    actor: "indie",
    payload: { name: "North Sample" },
    changed: ["name"],
  });
  assert.equal(indie.some((row) => row.audience === "indie" && row.kind === "data_change"), true);
  const failed = routesForEvent({
    entityType: "site",
    source: "check",
    actor: "indie",
    payload: { checked_live: "fail" },
    changed: ["checked_live"],
  });
  assert.equal(failed.some((row) => row.kind === "check_failed"), true);
  const sql = await ready();
  await insertFeedRow(sql, brokerMatchFeed("PIPE-PHX-0108"));
  const muse = await listInbox(sql, { audience: "muse" });
  const other = await listInbox(sql, { audience: "indie" });
  assert.equal(muse.items.some((item) => item.kind === "broker_match"), true);
  assert.equal(other.items.some((item) => item.kind === "broker_match"), false);
  const previousIndie = process.env.AGENT_WRITE_TOKEN_INDIE;
  const previousInbox = process.env.AGENT_INBOX_SECRET;
  process.env.AGENT_WRITE_TOKEN_INDIE = "indie-token";
  process.env.AGENT_INBOX_SECRET = "";
  try {
    const request = new Request("http://local/api/agent/inbox/ack", {
      method: "POST",
      headers: { authorization: "Bearer indie-token", "content-type": "application/json" },
      body: JSON.stringify({ ids: ["x"], status: "picked" }),
    });
    assert.equal(authorizeAgent(request)?.canAck, false);
    const response = await ackRoute(request);
    assert.equal(response.status, 403);
  } finally {
    if (previousIndie === undefined) delete process.env.AGENT_WRITE_TOKEN_INDIE;
    else process.env.AGENT_WRITE_TOKEN_INDIE = previousIndie;
    if (previousInbox === undefined) delete process.env.AGENT_INBOX_SECRET;
    else process.env.AGENT_INBOX_SECRET = previousInbox;
  }
  assert.equal(await ackInbox(sql, { ids: [], status: "picked" }).catch(() => "empty"), "empty");
});

test("a stale sweep skips a fresh site and the quarantined id", async () => {
  const sql = await ready();
  await sql.query(
    `INSERT INTO sites (site_id, name, address, market, category, updated_at, updated_by, version)
     VALUES ('PIPE-PHX-0108', 'North Sample', '1 Sample Road', 'PHX', 'Car wash', '2020-01-01T00:00:00Z', 'test', 1)`,
  );
  const count = await sweepStale(sql, new Date("2026-11-16T00:00:00Z"));
  assert.equal(count, 1);
  const rows = await listInbox(sql, { audience: "all" });
  assert.equal(rows.items.some((item) => item.kind === "stale" && item.siteId === "PIPE-PHX-0108"), true);
  assert.equal(rows.items.some((item) => item.siteId === "PIPE-PHX-0006"), false);
});

test("getBroker is not available yet and backfill refuses production without confirmation", async () => {
  assert.deepEqual(await runAskTool("getBroker", { id: "sample" }, "reviewer"), { status: "not_yet_available" });
  const previous = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "production";
  try {
    const refused = backfillDecision("postgres://db.example/app", false);
    assert.equal(refused.ok, false);
    const allowed = backfillDecision("postgres://db.example/app", true);
    assert.equal(allowed.ok, true);
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous;
  }
});

function comms(extra: Record<string, unknown> = {}) {
  return {
    entity_type: "comms",
    site_id: "PIPE-PHX-0001",
    expected_version: 0,
    source: "desk",
    payload: { direction: "in", summary: "Desk note.", ...extra },
  };
}

function activity(date: string, approximate = false) {
  return {
    entity_type: "activity",
    site_id: "PIPE-PHX-0001",
    expected_version: 0,
    source: "desk",
    payload: { date, type: "listing", summary: "Noted", ...(approximate ? { at_approximate: true } : {}) },
  };
}
