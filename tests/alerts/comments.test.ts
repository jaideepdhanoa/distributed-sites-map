import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { createNote } from "../../lib/actions/notes";
import type { RecordLookup } from "../../lib/actions/records";
import { savePreferences, defaultPreferences, loadPreferences } from "../../lib/alerts/preferences";
import { losAngelesParts } from "../../lib/alerts/clock";
import { commentHref, mailLink } from "../../lib/alerts/links";
import { memorySql } from "../helpers/sql";

const site = Object.freeze({
  site_id: "PHX-U180",
  name: "Sample Wash",
  pipeline_stage: "1 Desk screen",
  listed: false,
  linked_deal_id: "PIPE-PHX-0008",
});
const deal = Object.freeze({ deal_id: "PIPE-PHX-0008", stage: "1 Desk screen", name: "Sample deal" });
const lookup: RecordLookup = (kind, id) => {
  if (kind === "site" && id === site.site_id) return site;
  if (kind === "deal" && id === deal.deal_id) return deal;
  return null;
};

const users = [
  { u: "reviewer", h: "$2b$10$commentsplaceholderhashplaceholderhashplace", role: "user", actionRole: "reviewer", name: "Reviewer", email: "reviewer@example.com" },
  { u: "contributor", h: "$2b$10$commentsplaceholderhashplaceholderhashplace", role: "user", actionRole: "contributor", name: "Contributor", email: "contributor@example.com" },
  { u: "jaideep", h: "$2b$10$commentsplaceholderhashplaceholderhashplace", role: "user", actionRole: "reviewer", name: "Owner", email: "owner@example.com" },
];

process.env.AUTH_USERS = JSON.stringify(users);
process.env.ALERT_BATCH_MS = "0";
process.env.ALERT_EMAILS = "";

async function ready() {
  const sql = await memorySql();
  await migrate(sql);
  return sql;
}

test("a followed reviewer gets one comment email that opens the note", async () => {
  const sql = await ready();
  await createNote(sql, {
    targetKind: "deal",
    targetId: deal.deal_id,
    body: "The frontage needs a second look.",
    authorId: "reviewer",
  }, lookup);
  const posted = await createNote(sql, {
    targetKind: "deal",
    targetId: deal.deal_id,
    body: "Please look at the frontage.",
    authorId: "contributor",
  }, lookup);
  const rows = await sql.query<{ body: string; status: string; user_id: string }>(
    `SELECT body, status, user_id FROM alert_log WHERE user_id = 'reviewer'`,
  );
  const hits = rows.rows.filter((row) => row.body.includes("Please look at the frontage."));
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.status, "would_send");
  assert.match(hits[0]?.body || "", new RegExp(`note=${posted.id}`));
  assert.doesNotMatch(hits[0]?.body || "", /gmail|broker/i);
  const href = mailLink({
    category: "comments",
    siteId: deal.deal_id,
    href: commentHref(deal.deal_id, posted.id),
  });
  assert.match(href, new RegExp(`note=${posted.id}`));
});

test("turning Comments off stops the follower email", async () => {
  const sql = await ready();
  await createNote(sql, {
    targetKind: "deal",
    targetId: deal.deal_id,
    body: "The frontage needs a second look.",
    authorId: "reviewer",
  }, lookup);
  await savePreferences(sql, "reviewer", { ...defaultPreferences("reviewer"), comments: "off" });
  await createNote(sql, {
    targetKind: "deal",
    targetId: deal.deal_id,
    body: "Please look at the frontage.",
    authorId: "contributor",
  }, lookup);
  const rows = await sql.query<{ body: string }>(`SELECT body FROM alert_log WHERE user_id = 'reviewer'`);
  assert.equal(rows.rows.filter((row) => row.body.includes("Please look at the frontage.")).length, 0);
  const queued = await sql.query<{ id: string }>(
    `SELECT id FROM alert_outbox WHERE user_id = 'reviewer' AND category = 'comments'`,
  );
  assert.equal(queued.rows.length, 0);
});

test("a seventh instant comment rolls into the digest", async () => {
  const sql = await ready();
  const day = losAngelesParts(new Date()).day;
  for (let index = 0; index < 6; index += 1) {
    await sql.query(
      `INSERT INTO alert_log (id, idempotency_key, user_id, to_email, subject, body, status, sent_on)
       VALUES ($1, $2, 'reviewer', 'reviewer@example.com', 'Earlier', 'Earlier note.', 'sent', $3)`,
      [`log-${index}`, `batch:reviewer:${index}`, day],
    );
  }
  await createNote(sql, {
    targetKind: "deal",
    targetId: deal.deal_id,
    body: "The frontage needs a second look.",
    authorId: "contributor",
  }, lookup);
  await sql.query(
    `INSERT INTO queue_follows (user_id, site_id) VALUES ('reviewer', $1) ON CONFLICT DO NOTHING`,
    [deal.deal_id],
  );
  await createNote(sql, {
    targetKind: "deal",
    targetId: deal.deal_id,
    body: "One more note after the cap.",
    authorId: "contributor",
  }, lookup);
  const queued = await sql.query<{ channel: string; status: string }>(
    `SELECT channel, status FROM alert_outbox WHERE user_id = 'reviewer' AND category = 'comments'`,
  );
  assert.equal(queued.rows.length, 1);
  assert.equal(queued.rows[0]?.channel, "digest");
  assert.equal(queued.rows[0]?.status, "pending");
});

test("the quarantined site sends nothing", async () => {
  const sql = await ready();
  await sql.query(
    `INSERT INTO queue_follows (user_id, site_id) VALUES ('reviewer', 'PIPE-PHX-0006') ON CONFLICT DO NOTHING`,
  );
  const excluded = Object.freeze({ deal_id: "PIPE-PHX-0006", stage: "1 Desk screen", name: "Held" });
  const excludedLookup: RecordLookup = (kind, id) => (kind === "deal" && id === excluded.deal_id ? excluded : null);
  await createNote(sql, {
    targetKind: "deal",
    targetId: "PIPE-PHX-0006",
    body: "This note stays inside the record.",
    authorId: "contributor",
  }, excludedLookup);
  const rows = await sql.query<{ id: string }>(`SELECT id FROM alert_outbox`);
  assert.equal(rows.rows.length, 0);
});

test("an agent comment uses the same follower path", async () => {
  const sql = await ready();
  await createNote(sql, {
    targetKind: "deal",
    targetId: deal.deal_id,
    body: "The frontage needs a second look.",
    authorId: "reviewer",
  }, lookup);
  const posted = await createNote(sql, {
    targetKind: "deal",
    targetId: deal.deal_id,
    body: "Agent note on the frontage.",
    authorId: "agent",
  }, lookup);
  const rows = await sql.query<{ body: string }>(`SELECT body FROM alert_log WHERE user_id = 'reviewer'`);
  assert.equal(rows.rows.filter((row) => row.body.includes(posted.body)).length, 1);
});

test("the owner hears a comment on a site he never touched until Follow all is off", async () => {
  const sql = await ready();
  const land = Object.freeze({ deal_id: "LAND-PHX-0101", stage: "0 Passed on", name: "Sample land" });
  const landLookup: RecordLookup = (kind, id) => (kind === "deal" && id === land.deal_id ? land : lookup(kind, id));
  const before = await sql.query<{ user_id: string }>(`SELECT user_id FROM queue_follows WHERE user_id = 'jaideep'`);
  assert.equal(before.rows.length, 0);
  const posted = await createNote(sql, {
    targetKind: "deal",
    targetId: land.deal_id,
    body: "A note on a site the owner never opened.",
    authorId: "contributor",
  }, landLookup);
  const rows = await sql.query<{ body: string; status: string }>(`SELECT body, status FROM alert_log WHERE user_id = 'jaideep'`);
  const hits = rows.rows.filter((row) => row.body.includes("A note on a site the owner never opened."));
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.status, "would_send");
  assert.match(hits[0]?.body || "", new RegExp(`note=${posted.id}`));
  const follows = await sql.query<{ user_id: string }>(`SELECT user_id FROM queue_follows WHERE user_id = 'jaideep'`);
  assert.equal(follows.rows.length, 0);
  const prefs = await loadPreferences(sql, "jaideep");
  assert.equal(prefs?.followAll, true);
  assert.equal(prefs?.comments, "instant");
  await savePreferences(sql, "jaideep", { ...prefs, followAll: false });
  await createNote(sql, {
    targetKind: "deal",
    targetId: land.deal_id,
    body: "A later note stays quiet for the owner.",
    authorId: "contributor",
  }, landLookup);
  const after = await sql.query<{ body: string }>(`SELECT body FROM alert_log WHERE user_id = 'jaideep'`);
  assert.equal(after.rows.filter((row) => row.body.includes("A later note stays quiet for the owner.")).length, 0);
  const queued = await sql.query<{ id: string }>(
    `SELECT id FROM alert_outbox WHERE user_id = 'jaideep' AND summary = 'A later note stays quiet for the owner.'`,
  );
  assert.equal(queued.rows.length, 0);
});

test("a seventh comment still reaches the owner instantly and another person rolls into the digest", async () => {
  const sql = await ready();
  const day = losAngelesParts(new Date()).day;
  for (const userId of ["jaideep", "reviewer"]) {
    for (let index = 0; index < 6; index += 1) {
      await sql.query(
        `INSERT INTO alert_log (id, idempotency_key, user_id, to_email, subject, body, status, sent_on)
         VALUES ($1, $2, $3, $4, 'Earlier', 'Earlier note.', 'sent', $5)`,
        [`${userId}-${index}`, `batch:${userId}:${index}`, userId, `${userId}@example.com`, day],
      );
    }
  }
  await sql.query(
    `INSERT INTO queue_follows (user_id, site_id) VALUES ('reviewer', $1) ON CONFLICT DO NOTHING`,
    [deal.deal_id],
  );
  await createNote(sql, {
    targetKind: "deal",
    targetId: deal.deal_id,
    body: "Comment number seven.",
    authorId: "contributor",
  }, lookup);
  const owner = await sql.query<{ channel: string; status: string }>(
    `SELECT channel, status FROM alert_outbox WHERE user_id = 'jaideep' AND category = 'comments'`,
  );
  assert.equal(owner.rows.length, 1);
  assert.equal(owner.rows[0]?.channel, "instant");
  assert.equal(owner.rows[0]?.status, "would_send");
  const ownerMail = await sql.query<{ body: string; status: string }>(
    `SELECT body, status FROM alert_log WHERE user_id = 'jaideep' AND body LIKE '%Comment number seven.%'`,
  );
  assert.equal(ownerMail.rows.length, 1);
  assert.equal(ownerMail.rows[0]?.status, "would_send");
  const other = await sql.query<{ channel: string; status: string }>(
    `SELECT channel, status FROM alert_outbox WHERE user_id = 'reviewer' AND category = 'comments'`,
  );
  assert.equal(other.rows.length, 1);
  assert.equal(other.rows[0]?.channel, "digest");
  assert.equal(other.rows[0]?.status, "pending");
});
