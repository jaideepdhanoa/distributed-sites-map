import { createHash, randomUUID } from "node:crypto";
import type { Sql } from "@/lib/actions/db";
import { resolveActionRole } from "@/lib/actions/roles";
import { stageTitle } from "@/lib/labels";
import { loadCatalog } from "@/lib/queue/catalog";
import { getUsers } from "@/lib/users";
import { digestCadence } from "./cadence";
import { DAILY_CAP, INSTANT_DAILY_CAP, batchWindowMs, digestWindowStart, isPacificMonday, losAngelesParts, stampOf, weekKey, weekOfLabel, weekWindowStart } from "./clock";
import { renderBatch, type MailItem } from "./compose";
import { isExcludedSite } from "./excluded";
import { isOwnerAccount } from "./owner";
import { proposalHref, reviewHomeHref } from "./links";
import { digestEnabled, loadPreferences, shouldSendDigest, type AlertCategory } from "./preferences";
import { emptyBrief, loadDigestBrief } from "./summary";
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

function asItem(row: OutboxRow, catalog: { id: string; stageGroup: string; city?: string; name?: string }[]): MailItem {
  const hit = catalog.find((item) => item.id === row.site_id);
  const stage = hit ? stageTitle(hit.stageGroup) : "";
  return {
    category: row.category,
    siteId: row.site_id,
    siteLabel: row.site_label,
    summary: row.summary,
    authorId: row.author_id,
    href: row.href,
    market: hit?.city || "",
    stage: stage === "Deal" ? "" : stage,
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
  input: {
    userId: string;
    email: string;
    rows: OutboxRow[];
    extra?: MailItem[];
    key: string;
    now?: Date;
    subjectPrefix?: string;
    subject?: string;
    kind?: "instant" | "digest" | "updates" | "catchup" | "week";
  },
): Promise<string> {
  const now = input.now || new Date();
  const day = losAngelesParts(now).day;
  const catalog = await loadCatalog();
  const items = [...(input.extra || []), ...input.rows.map((row) => asItem(row, catalog))];
  const rendered = renderBatch(items, { now, kind: input.kind, recipientId: input.userId });
  if (!rendered) {
    await markRows(sql, input.rows.map((row) => row.id), "skipped", input.key);
    return "skipped";
  }
  const base = input.subject?.trim() || rendered.subject;
  const subject = input.subjectPrefix ? `${input.subjectPrefix} ${base}`.replace(/\s+/g, " ").trim() : base;
  if (input.key.startsWith("batch:")) {
    await sql.query(
      `DELETE FROM alert_log
       WHERE user_id = $1 AND status = 'pending' AND idempotency_key LIKE 'batch:' || $1 || ':%' AND idempotency_key <> $2`,
      [input.userId, input.key],
    );
  }
  const claim = await claimLog(sql, {
    key: input.key,
    userId: input.userId,
    email: input.email,
    subject,
    body: rendered.body,
    day,
  });
  if (!claim.fresh && (claim.status === "sent" || claim.status === "would_send" || claim.status === "capped" || claim.status === "skipped")) {
    await markRows(sql, input.rows.map((row) => row.id), claim.status, input.key);
    return claim.status;
  }
  await sql.query(`UPDATE alert_log SET subject = $2, body = $3 WHERE id = $1`, [claim.id, subject, rendered.body]);
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
      subject,
      text: rendered.body,
      html: rendered.html,
    });
  } catch {
    await sql.query(`UPDATE alert_log SET status = 'pending', warning = $2 WHERE id = $1`, [claim.id, "Send failed. It will be tried again."]);
    return "error";
  }
  await sql.query(`UPDATE alert_log SET status = 'sent', sent_on = $2, warning = '' WHERE id = $1`, [claim.id, day]);
  await markRows(sql, input.rows.map((row) => row.id), "sent", input.key);
  return "sent";
}

const CLAIM_STALE_MS = 3 * 60 * 1000;
/** Older than the five-minute backstop, so a burst is not labeled a catch-up. */
const CATCH_UP_MS = 60 * 60 * 1000;

function instantBatchKind(rows: OutboxRow[], now: Date): "instant" | "updates" | "catchup" {
  if (now.getTime() - oldestStamp(rows) >= CATCH_UP_MS) return "catchup";
  if (rows.length > 1) return "updates";
  return "instant";
}

function claimToken(epochMs: number): string {
  return `claim:${String(Math.max(0, Math.floor(epochMs))).padStart(13, "0")}`;
}

function groupByUser(rows: OutboxRow[]): Map<string, OutboxRow[]> {
  const byUser = new Map<string, OutboxRow[]>();
  for (const row of rows) {
    const list = byUser.get(row.user_id) || [];
    list.push(row);
    byUser.set(row.user_id, list);
  }
  return byUser;
}

function oldestStamp(rows: OutboxRow[]): number {
  return rows.reduce((min, row) => Math.min(min, stampOf(row.created_at)), Number.POSITIVE_INFINITY);
}

async function rollback(sql: Sql): Promise<void> {
  try {
    await sql.exec("ROLLBACK");
  } catch {
    // The connection already closed the transaction.
  }
}

/**
 * Send instant rows whose oldest item is already due. A later row joins that
 * batch and does not postpone it. The claim is a row lock plus a sending
 * status, committed before the mail goes out, so a second flush cannot take
 * the same rows.
 */
export async function flushInstant(sql: Sql, now = new Date()): Promise<number> {
  const windowMs = batchWindowMs();
  const cutoff = new Date(now.getTime() - windowMs).toISOString();
  await sql.exec("BEGIN");
  let claimed: OutboxRow[] = [];
  try {
    await sql.query(
      `UPDATE alert_outbox
       SET status = 'pending', batch_key = NULL
       WHERE channel = 'instant' AND status = 'sending' AND batch_key LIKE 'claim:%' AND batch_key < $1`,
      [claimToken(Date.now() - CLAIM_STALE_MS)],
    );
    const pending = await sql.query<OutboxRow>(
      `SELECT id, idempotency_key, user_id, to_email, category, channel, site_id, site_label, summary, author_id, href, ref_id, created_at, status
       FROM alert_outbox
       WHERE channel = 'instant' AND status = 'pending'
         AND user_id IN (
           SELECT user_id FROM alert_outbox
           WHERE channel = 'instant' AND status = 'pending'
           GROUP BY user_id
           HAVING MIN(created_at) <= $1::timestamptz
         )
       ORDER BY created_at ASC, id ASC
       FOR UPDATE SKIP LOCKED`,
      [cutoff],
    );
    const ready: OutboxRow[] = [];
    for (const rows of groupByUser(pending.rows).values()) {
      if (now.getTime() - oldestStamp(rows) < windowMs) continue;
      ready.push(...rows);
    }
    if (!ready.length) {
      await sql.exec("COMMIT");
      return 0;
    }
    await markRows(sql, ready.map((row) => row.id), "sending", claimToken(Date.now()));
    await sql.exec("COMMIT");
    claimed = ready;
  } catch (error) {
    await rollback(sql);
    throw error;
  }

  let sent = 0;
  for (const [userId, rows] of groupByUser(claimed)) {
    const ids = rows.map((row) => row.id);
    try {
      const email = rows[0]?.to_email || accountEmail(userId) || "";
      if (!email) {
        await markRows(sql, ids, "skipped", `skip:${userId}`);
        continue;
      }
      const instantToday = await instantSentToday(sql, userId, losAngelesParts(now).day);
      if (!isOwnerAccount(userId) && instantToday >= INSTANT_DAILY_CAP) {
        await rollToDigest(sql, ids);
        continue;
      }
      const status = await deliverRows(sql, {
        userId,
        email,
        rows,
        key: batchKey("batch", userId, ids),
        now,
        kind: instantBatchKind(rows, now),
      });
      if (status === "error") {
        await markRows(sql, ids, "pending", "");
        continue;
      }
      sent += 1;
    } catch (error) {
      try {
        await markRows(sql, ids, "pending", "");
      } catch {
        // A later flush reclaims a stale sending claim.
      }
      throw error;
    }
  }
  return sent;
}

async function siteLabel(siteId: string): Promise<string> {
  const hit = (await loadCatalog()).find((item) => item.id === siteId);
  const name = hit?.name?.trim();
  if (name && name !== siteId) return `${name} (${siteId})`;
  return siteId;
}

type SuggestionRow = { id: string; title: string | null; proposed_value: string; author_id: string; target_id: string; field_name: string };

async function followedItems(sql: Sql, userId: string, since: Date): Promise<MailItem[]> {
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
  for (const row of suggestions.rows) {
    items.push({
      category: "followed",
      siteId: row.target_id,
      siteLabel: await siteLabel(row.target_id),
      summary: row.title || row.proposed_value,
      authorId: row.author_id,
      href: proposalHref(row.target_id),
    });
  }
  return items;
}

async function instantSentToday(sql: Sql, userId: string, day: string): Promise<number> {
  const rows = await sql.query<{ count: string | number }>(
    `SELECT COUNT(*)::text AS count FROM alert_log
     WHERE user_id = $1 AND status = 'sent' AND sent_on = $2 AND idempotency_key LIKE 'batch:' || $1 || ':%'`,
    [userId, day],
  );
  return Number(rows.rows[0]?.count || 0);
}

async function rollToDigest(sql: Sql, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(", ");
  await sql.query(
    `UPDATE alert_outbox SET channel = 'digest', status = 'pending', batch_key = NULL WHERE id IN (${placeholders})`,
    ids,
  );
}

async function pendingDigest(sql: Sql, userId: string): Promise<OutboxRow[]> {
  const pending = await sql.query<OutboxRow>(
    `SELECT id, idempotency_key, user_id, to_email, category, channel, site_id, site_label, summary, author_id, href, ref_id, created_at, status
     FROM alert_outbox WHERE user_id = $1 AND channel = 'digest' AND status = 'pending' ORDER BY created_at ASC, id ASC`,
    [userId],
  );
  return pending.rows;
}

async function reviewCount(sql: Sql, userId: string, reviewer: boolean): Promise<number> {
  const { loadQueue } = await import("@/lib/queue/load");
  const queue = await loadQueue(sql, userId, { market: "all", viable: true }, reviewer);
  return queue.items.filter((item) => !isExcludedSite(item.siteId)).length;
}

async function sendDaily(sql: Sql, user: { u: string; h: string; role: string }, email: string, now: Date): Promise<boolean> {
  const userId = user.u;
  const prefs = await loadPreferences(sql, userId);
  if (!prefs) return false;
  const { day } = losAngelesParts(now);
  const already = await sql.query<{ user_id: string }>(
    `SELECT user_id FROM alert_digest_runs WHERE user_id = $1 AND sent_on = $2`,
    [userId, day],
  );
  if (already.rows.length) return false;
  const pending = await pendingDigest(sql, userId);
  const prior = await sql.query<{ sent_at: Date | string }>(
    `SELECT sent_at FROM alert_digest_runs WHERE user_id = $1`,
    [userId],
  );
  const priorAt = prior.rows[0] ? new Date(stampOf(prior.rows[0].sent_at)) : null;
  // No earlier checkpoint, and a checkpoint from before midnight Nov 16 PT, both
  // stop at that midnight. The Nov 15 workbook import is outside this window.
  const windowStart = digestWindowStart(now, priorAt);
  const digestOn = digestEnabled(prefs);
  const followed = digestOn ? await followedItems(sql, userId, windowStart) : [];
  const brief = digestOn ? await loadDigestBrief(sql, { userId, since: windowStart, prefs }) : emptyBrief();
  let queueCount = 0;
  if (digestOn) queueCount = await reviewCount(sql, userId, resolveActionRole(user) === "reviewer");
  if (!shouldSendDigest({ items: pending.length + followed.length + brief.items.length, queueCount, digestOn })) return false;
  const extra = [...brief.items, ...followed];
  if (digestOn && queueCount > 0) {
    extra.unshift({
      category: "queue",
      siteId: "",
      siteLabel: "",
      summary: `${queueCount} waiting in Review`,
      authorId: userId,
      href: reviewHomeHref(),
    });
  }
  const status = await deliverRows(sql, {
    userId,
    email,
    rows: pending,
    extra,
    key: `digest:${userId}:${day}`,
    now,
    kind: "digest",
  });
  if (status === "error") return false;
  await sql.query(
    `INSERT INTO alert_digest_runs (user_id, sent_on, sent_at) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET sent_on = EXCLUDED.sent_on, sent_at = EXCLUDED.sent_at`,
    [userId, day, now.toISOString()],
  );
  return true;
}

async function sendWeekly(sql: Sql, userId: string, email: string, now: Date): Promise<boolean> {
  const prefs = await loadPreferences(sql, userId);
  if (!prefs) return false;
  const key = `week:${userId}:${weekKey(now)}`;
  const already = await sql.query<{ id: string }>(
    `SELECT id FROM alert_log WHERE idempotency_key = $1 AND status IN ('sent', 'would_send', 'capped', 'skipped')`,
    [key],
  );
  if (already.rows.length) return false;
  const since = weekWindowStart(now);
  const digestOn = digestEnabled(prefs);
  const pending = await pendingDigest(sql, userId);
  const followed = digestOn ? await followedItems(sql, userId, since) : [];
  const brief = digestOn ? await loadDigestBrief(sql, { userId, since, prefs }) : emptyBrief();
  if (pending.length + followed.length + brief.items.length === 0) return false;
  const status = await deliverRows(sql, {
    userId,
    email,
    rows: pending,
    extra: [...brief.items, ...followed],
    key,
    now,
    kind: "week",
    subject: `Distributed Sites: week of ${weekOfLabel(now)}`,
  });
  return status !== "error";
}

export async function sendDigests(sql: Sql, now = new Date()): Promise<number> {
  // Two UTC hours cover 7:00 AM Pacific in both standard time and daylight time.
  // A run outside that hour does not send and does not consume the day's idempotency key.
  const parts = losAngelesParts(now);
  if (parts.hour !== 7) return 0;
  const monday = isPacificMonday(now);
  let count = 0;
  for (const user of getUsers()) {
    if (resolveActionRole(user) == null) continue;
    const email = accountEmail(user.u);
    if (!email) continue;
    const cadence = digestCadence(user.u);
    if (cadence.daily && await sendDaily(sql, user, email, now)) count += 1;
    if (monday && cadence.weekly && await sendWeekly(sql, user.u, email, now)) count += 1;
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
  if (isExcludedSite(input.siteId)) return;
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
