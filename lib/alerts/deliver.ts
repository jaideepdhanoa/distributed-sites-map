import { createHash, randomUUID } from "node:crypto";
import type { Sql } from "@/lib/actions/db";
import { resolveActionRole } from "@/lib/actions/roles";
import { loadCatalog } from "@/lib/queue/catalog";
import { getUsers } from "@/lib/users";
import { DAILY_CAP, batchWindowMs, losAngelesParts, stampOf } from "./clock";
import { renderBatch, type MailItem } from "./compose";
import { discussionHref, reviewHomeHref } from "./links";
import { digestEnabled, loadPreferences, shouldSendDigest, type AlertCategory } from "./preferences";
import { accountEmail } from "./recipients";
import { alertFrom, alertReplyTo, liveMailAllowed, mailTransport } from "./transport";

export type OutboxRow = {
  id: string;
  idempotency_key: string;
  user_id: string;
  to_email: string;
  category: MailItem["category"];
  channel: "instant" | "digest";
  site_id: string;
  site_label: string;
  summary: string;
  author_id: string;
  href: string;
  ref_id: string | null;
  created_at: Date | string;
  status: string;
};

function batchKey(prefix: string, userId: string, ids: string[]): string {
  const hash = createHash("sha256").update([...ids].sort().join("|")).digest("hex").slice(0, 32);
  return `${prefix}:${userId}:${hash}`;
}

function asItem(row: OutboxRow): MailItem {
  return {
    category: row.category,
    siteId: row.site_id,
    siteLabel: row.site_label,
    summary: row.summary,
    authorId: row.author_id,
    href: row.href,
  };
}

async function sentToday(sql: Sql, day: string): Promise<number> {
  const rows = await sql.query<{ count: string | number }>(
    `SELECT COUNT(*)::text AS count FROM alert_log WHERE status = 'sent' AND sent_on = $1`,
    [day],
  );
  return Number(rows.rows[0]?.count || 0);
}

async function markRows(sql: Sql, ids: string[], status: string, key: string): Promise<void> {
  if (!ids.length) return;
  const placeholders = ids.map((_, index) => `$${index + 3}`).join(", ");
  await sql.query(
    `UPDATE alert_outbox SET status = $1, batch_key = $2 WHERE id IN (${placeholders})`,
    [status, key, ...ids],
  );
}

async function claimLog(
  sql: Sql,
  input: { key: string; userId: string; email: string; subject: string; body: string; day: string },
): Promise<{ id: string; status: string; fresh: boolean }> {
  const id = randomUUID();
  const inserted = await sql.query<{ id: string }>(
    `INSERT INTO alert_log (id, idempotency_key, user_id, to_email, subject, body, status, warning, sent_on)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', '', $7)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [id, input.key, input.userId, input.email, input.subject, input.body, input.day],
  );
  if (inserted.rows[0]) return { id: inserted.rows[0].id, status: "pending", fresh: true };
  const existing = await sql.query<{ id: string; status: string }>(
    `SELECT id, status FROM alert_log WHERE idempotency_key = $1`,
    [input.key],
  );
  const row = existing.rows[0];
  return { id: row?.id || id, status: row?.status || "pending", fresh: false };
}

export async function deliverRows(
  sql: Sql,
  input: { userId: string; email: string; rows: OutboxRow[]; extra?: MailItem[]; key: string; now?: Date },
): Promise<string> {
  const now = input.now || new Date();
  const day = losAngelesParts(now).day;
  const items = [...(input.extra || []), ...input.rows.map(asItem)];
  const rendered = renderBatch(items);
  if (!rendered) {
    await markRows(sql, input.rows.map((row) => row.id), "skipped", input.key);
    return "skipped";
  }
  const claim = await claimLog(sql, {
    key: input.key,
    userId: input.userId,
    email: input.email,
    subject: rendered.subject,
    body: rendered.body,
    day,
  });
  if (!claim.fresh && (claim.status === "sent" || claim.status === "would_send" || claim.status === "capped" || claim.status === "skipped")) {
    await markRows(sql, input.rows.map((row) => row.id), claim.status, input.key);
    return claim.status;
  }
  await sql.query(`UPDATE alert_log SET subject = $2, body = $3 WHERE id = $1`, [claim.id, rendered.subject, rendered.body]);
  const transport = mailTransport();
  const from = alertFrom();
  const optedIn = liveMailAllowed(input.userId);
  if (!transport || !from || !optedIn) {
    const warning = transport && from && !optedIn ? "Recorded only. This account is not approved for live mail." : "";
    await sql.query(`UPDATE alert_log SET status = 'would_send', warning = $2 WHERE id = $1`, [claim.id, warning]);
    await markRows(sql, input.rows.map((row) => row.id), "would_send", input.key);
    return "would_send";
  }
  const already = await sentToday(sql, day);
  if (already >= DAILY_CAP) {
    const warning = "Daily send cap of 400 reached. This message was not sent.";
    await sql.query(`UPDATE alert_log SET status = 'capped', warning = $2 WHERE id = $1`, [claim.id, warning]);
    await markRows(sql, input.rows.map((row) => row.id), "capped", input.key);
    return "capped";
  }
  try {
    await transport.send({
      to: input.email,
      from,
      replyTo: alertReplyTo(),
      subject: rendered.subject,
      text: rendered.body,
    });
  } catch {
    await sql.query(`UPDATE alert_log SET status = 'pending', warning = $2 WHERE id = $1`, [claim.id, "Send failed. It will be tried again."]);
    return "error";
  }
  await sql.query(`UPDATE alert_log SET status = 'sent', sent_on = $2, warning = '' WHERE id = $1`, [claim.id, day]);
  await markRows(sql, input.rows.map((row) => row.id), "sent", input.key);
  return "sent";
}

export async function flushInstant(sql: Sql, now = new Date()): Promise<number> {
  const windowMs = batchWindowMs();
  const pending = await sql.query<OutboxRow>(
    `SELECT id, idempotency_key, user_id, to_email, category, channel, site_id, site_label, summary, author_id, href, ref_id, created_at, status
     FROM alert_outbox WHERE channel = 'instant' AND status = 'pending' ORDER BY created_at ASC, id ASC`,
  );
  const byUser = new Map<string, OutboxRow[]>();
  for (const row of pending.rows) {
    const list = byUser.get(row.user_id) || [];
    list.push(row);
    byUser.set(row.user_id, list);
  }
  let sent = 0;
  for (const [userId, rows] of byUser) {
    const newest = rows.reduce((max, row) => Math.max(max, stampOf(row.created_at)), 0);
    if (now.getTime() - newest < windowMs) continue;
    const email = rows[0]?.to_email || accountEmail(userId) || "";
    if (!email) {
      await markRows(sql, rows.map((row) => row.id), "skipped", `skip:${userId}`);
      continue;
    }
    await deliverRows(sql, {
      userId,
      email,
      rows,
      key: batchKey("batch", userId, rows.map((row) => row.id)),
      now,
    });
    sent += 1;
  }
  return sent;
}

function siteLabel(siteId: string): string {
  const hit = loadCatalog().find((item) => item.id === siteId);
  const name = hit?.name?.trim();
  if (name && name !== siteId) return `${name} (${siteId})`;
  return siteId;
}

type NoteRow = { id: string; body: string; author_id: string; target_id: string };
type SuggestionRow = { id: string; title: string | null; proposed_value: string; author_id: string; target_id: string; field_name: string };

async function followedItems(sql: Sql, userId: string, since: Date): Promise<MailItem[]> {
  const notes = await sql.query<NoteRow>(
    `SELECT n.id, n.body, n.author_id, n.target_id
     FROM notes n
     JOIN queue_follows f ON f.site_id = n.target_id AND f.user_id = $1
     WHERE n.deleted_at IS NULL AND n.parent_id IS NULL AND n.created_at > $2 AND n.author_id <> $1
       AND NOT EXISTS (SELECT 1 FROM alert_outbox o WHERE o.user_id = $1 AND o.ref_id = n.id)
     ORDER BY n.created_at ASC`,
    [userId, since],
  );
  const suggestions = await sql.query<SuggestionRow>(
    `SELECT s.id, s.title, s.proposed_value, s.author_id, s.target_id, s.field_name
     FROM suggestions s
     JOIN queue_follows f ON f.site_id = s.target_id AND f.user_id = $1
     WHERE s.created_at > $2 AND s.author_id <> $1
       AND NOT EXISTS (SELECT 1 FROM alert_outbox o WHERE o.user_id = $1 AND o.ref_id = s.id)
     ORDER BY s.created_at ASC`,
    [userId, since],
  );
  const items: MailItem[] = [];
  for (const note of notes.rows) {
    items.push({
      category: "followed",
      siteId: note.target_id,
      siteLabel: siteLabel(note.target_id),
      summary: note.body,
      authorId: note.author_id,
      href: discussionHref(note.target_id),
    });
  }
  for (const row of suggestions.rows) {
    items.push({
      category: "followed",
      siteId: row.target_id,
      siteLabel: siteLabel(row.target_id),
      summary: row.title || row.proposed_value,
      authorId: row.author_id,
      href: discussionHref(row.target_id),
    });
  }
  return items;
}

export async function sendDigests(sql: Sql, now = new Date()): Promise<number> {
  // Vercel Hobby runs this once, inside the 15:00 UTC hour (7:00 AM PST, 8:00 AM PDT).
  // The Pacific calendar day is the idempotency key, so a late fire still counts as that day.
  const { day } = losAngelesParts(now);
  let count = 0;
  for (const user of getUsers()) {
    if (resolveActionRole(user) == null) continue;
    const email = accountEmail(user.u);
    const prefs = await loadPreferences(sql, user.u);
    if (!email || !prefs) continue;
    const already = await sql.query<{ user_id: string }>(
      `SELECT user_id FROM alert_digest_runs WHERE user_id = $1 AND sent_on = $2`,
      [user.u, day],
    );
    if (already.rows.length) continue;
    const pending = await sql.query<OutboxRow>(
      `SELECT id, idempotency_key, user_id, to_email, category, channel, site_id, site_label, summary, author_id, href, ref_id, created_at, status
       FROM alert_outbox WHERE user_id = $1 AND channel = 'digest' AND status = 'pending' ORDER BY created_at ASC, id ASC`,
      [user.u],
    );
    const prior = await sql.query<{ sent_at: Date | string }>(
      `SELECT sent_at FROM alert_digest_runs WHERE user_id = $1`,
      [user.u],
    );
    const since = prior.rows[0] ? new Date(stampOf(prior.rows[0].sent_at)) : new Date(0);
    const followed = digestEnabled(prefs) ? await followedItems(sql, user.u, since) : [];
    let queueCount = 0;
    if (digestEnabled(prefs)) {
      const { loadQueue } = await import("@/lib/queue/load");
      const queue = await loadQueue(sql, user.u, { market: "all", viable: true }, resolveActionRole(user) === "reviewer");
      queueCount = queue.items.length;
    }
    const digestOn = digestEnabled(prefs);
    if (!shouldSendDigest({ items: pending.rows.length + followed.length, queueCount, digestOn })) continue;
    const extra = [...followed];
    if (queueCount > 0) {
      extra.unshift({
        category: "queue",
        siteId: "",
        siteLabel: "",
        summary: `${queueCount} waiting in Review`,
        authorId: user.u,
        href: reviewHomeHref(),
      });
    }
    const status = await deliverRows(sql, {
      userId: user.u,
      email,
      rows: pending.rows,
      extra,
      key: `digest:${user.u}:${day}`,
      now,
    });
    if (status === "error") continue;
    await sql.query(
      `INSERT INTO alert_digest_runs (user_id, sent_on, sent_at) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET sent_on = EXCLUDED.sent_on, sent_at = EXCLUDED.sent_at`,
      [user.u, day, now.toISOString()],
    );
    count += 1;
  }
  return count;
}

export async function enqueueAlert(
  sql: Sql,
  input: {
    userId: string;
    email: string;
    category: AlertCategory;
    channel: "instant" | "digest";
    siteId: string;
    siteLabel: string;
    summary: string;
    authorId: string;
    href: string;
    refId: string;
    idempotencyKey: string;
  },
): Promise<void> {
  await sql.query(
    `INSERT INTO alert_outbox (
      id, idempotency_key, user_id, to_email, category, channel, site_id, site_label, summary, author_id, href, ref_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      randomUUID(),
      input.idempotencyKey,
      input.userId,
      input.email,
      input.category,
      input.channel,
      input.siteId,
      input.siteLabel,
      input.summary,
      input.authorId,
      input.href,
      input.refId,
    ],
  );
}
