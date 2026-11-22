import { ingestFlag, ingestNote, ingestSuggestion } from "@/lib/agent/inbox";
import type { Sql } from "@/lib/actions/db";
import { resolveActionRole } from "@/lib/actions/roles";
import { loadCatalog } from "@/lib/queue/catalog";
import { getUsers } from "@/lib/users";
import { commentHref, discussionHref, proposalHref, reviewHref } from "./links";
import { batchWindowMs } from "./clock";
import { enqueueAlert, flushInstant } from "./deliver";
import { isExcludedSite } from "./excluded";
import { scheduleInstantFlush } from "./schedule";
import { isOwnerAccount } from "./owner";
import { deliveryMode, loadPreferences, type AlertCategory } from "./preferences";
import { deliveryRecipients } from "./recipients";

async function siteLabel(siteId: string): Promise<string> {
  const hit = (await loadCatalog()).find((item) => item.id === siteId);
  const name = hit?.name?.trim();
  if (name && name !== siteId) return `${name} (${siteId})`;
  return siteId;
}

async function flushQueued(sql: Sql): Promise<void> {
  // A zero window has nothing to coalesce. Send before the response so the row is logged.
  // Any longer window waits in the background, measured from the oldest unsent item.
  if (batchWindowMs() === 0) {
    await flushInstant(sql);
    return;
  }
  scheduleInstantFlush();
}

async function queueFor(
  sql: Sql,
  input: {
    actorId: string;
    userIds: string[];
    category: AlertCategory;
    siteId: string;
    summary: string;
    href: string;
    refId: string;
    channel?: "instant" | "digest";
    force?: boolean;
  },
): Promise<boolean> {
  if (isExcludedSite(input.siteId)) return false;
  const prefsCache = new Map<string, Awaited<ReturnType<typeof loadPreferences>>>();
  let instant = false;
  for (const recipient of deliveryRecipients(input.actorId, input.userIds)) {
    let prefs = prefsCache.get(recipient.userId);
    if (prefs === undefined) {
      prefs = await loadPreferences(sql, recipient.userId);
      prefsCache.set(recipient.userId, prefs);
    }
    const follows = prefs ? await followsSite(sql, recipient.userId, input.siteId, prefs.followAll) : false;
    const mode = prefs ? deliveryMode(prefs, input.category, follows) : "off";
    if (!input.force && mode === "off") continue;
    const channel = input.force ? input.channel || "instant" : mode === "instant" ? "instant" : "digest";
    await enqueueAlert(sql, {
      userId: recipient.userId,
      email: recipient.email,
      category: input.category,
      channel,
      siteId: input.siteId,
      siteLabel: await siteLabel(input.siteId),
      summary: input.summary,
      authorId: input.actorId,
      href: input.href,
      refId: input.refId,
      idempotencyKey: `${input.category}:${input.refId}:${recipient.userId}`,
    });
    if (channel === "instant") instant = true;
  }
  return instant;
}

function reviewerIds(): string[] {
  return getUsers().filter((user) => resolveActionRole(user) === "reviewer").map((user) => user.u);
}

export function reviewerRecipients(): string[] {
  return reviewerIds();
}

async function finishInstant(sql: Sql, instant: boolean): Promise<void> {
  if (!instant) return;
  await flushQueued(sql);
}

/** Queue one alert for an agent write. The author is never a recipient. The quarantined site is skipped. */
export async function queueAgentAlert(
  sql: Sql,
  input: {
    actorId: string;
    userIds: string[];
    category: AlertCategory;
    siteId: string;
    summary: string;
    href: string;
    refId: string;
    channel?: "instant" | "digest";
    force?: boolean;
  },
): Promise<boolean> {
  if (isExcludedSite(input.siteId)) return false;
  const instant = await queueFor(sql, input);
  await finishInstant(sql, instant);
  return instant;
}

async function noteAnchor(sql: Sql, noteId: string): Promise<{ type: string; line: string; period: string; spaceId: string } | null> {
  try {
    const rows = await sql.query<{ anchor_type: string | null; anchor_line: string | null; anchor_period: string | null; anchor_space_id: string | null }>(
      `SELECT anchor_type, anchor_line, anchor_period, anchor_space_id FROM notes WHERE id = $1`,
      [noteId],
    );
    const row = rows.rows[0];
    if (!row?.anchor_type) return null;
    return { type: row.anchor_type, line: row.anchor_line || "", period: row.anchor_period || "", spaceId: row.anchor_space_id || "" };
  } catch {
    return null;
  }
}

async function followsSite(sql: Sql, userId: string, siteId: string, followAll: boolean): Promise<boolean> {
  if (followAll) return true;
  const rows = await sql.query<{ user_id: string }>(
    `SELECT user_id FROM queue_follows WHERE user_id = $1 AND site_id = $2 LIMIT 1`,
    [userId, siteId],
  );
  return rows.rows.length > 0;
}

async function followerIds(sql: Sql, siteId: string): Promise<string[]> {
  const rows = await sql.query<{ user_id: string }>(`SELECT user_id FROM queue_follows WHERE site_id = $1`, [siteId]);
  return rows.rows.map((row) => row.user_id);
}

/** The owner follows every site without a queue_follows row, including sites created later. */
async function followAllIds(sql: Sql): Promise<string[]> {
  const ids: string[] = [];
  for (const user of getUsers()) {
    if (!isOwnerAccount(user.u)) continue;
    const prefs = await loadPreferences(sql, user.u);
    if (prefs?.followAll) ids.push(user.u);
  }
  return ids;
}

export async function notifyNote(
  sql: Sql,
  input: { noteId: string; siteId: string; recordId?: string; body: string; authorId: string; parentId: string | null; mentionIds: string[] },
): Promise<void> {
  const anchor = await noteAnchor(sql, input.noteId);
  const recordId = input.recordId || "";
  const spaceTarget = /^SS-\d{4,}$/.test(recordId) ? { type: "space", line: "", period: "", spaceId: recordId } : null;
  const href = commentHref(input.siteId, input.noteId, anchor?.type ? anchor : spaceTarget);
  let instant = false;
  if (!input.parentId) {
    const mentioned = new Set(input.mentionIds.map((id) => id.trim().toLowerCase()));
    const followers = [...new Set([...(await followerIds(sql, input.siteId)), ...(await followAllIds(sql))])].filter((id) => !mentioned.has(id.trim().toLowerCase()));
    if (await queueFor(sql, {
      actorId: input.authorId,
      userIds: followers,
      category: "comments",
      siteId: input.siteId,
      summary: input.body,
      href,
      refId: input.noteId,
    })) instant = true;
  }
  if (input.parentId) {
    const people = await sql.query<{ user_id: string }>(
      `SELECT author_id AS user_id FROM notes WHERE id = $1 OR parent_id = $1
       UNION
       SELECT user_id FROM mentions WHERE source_id = $1 OR source_id IN (SELECT id FROM notes WHERE parent_id = $1)`,
      [input.parentId],
    );
    const mentioned = new Set(input.mentionIds.map((id) => id.trim().toLowerCase()));
    const participants = people.rows.map((row) => row.user_id).filter((id) => !mentioned.has(id.trim().toLowerCase()));
    if (await queueFor(sql, {
      actorId: input.authorId,
      userIds: participants,
      category: "replies",
      siteId: input.siteId,
      summary: input.body,
      href,
      refId: input.noteId,
    })) instant = true;
  }
  if (await queueFor(sql, {
    actorId: input.authorId,
    userIds: input.mentionIds,
    category: "mentions",
    siteId: input.siteId,
    summary: input.body,
    href,
    refId: input.noteId,
  })) instant = true;
  if (instant) await flushQueued(sql);
  await ingestNote(sql, input);
}

export async function notifySuggestion(
  sql: Sql,
  input: { id: string; siteId: string; authorId: string; field: string; summary: string; ownerId: string | null; mentionIds: string[] },
): Promise<void> {
  const approval = input.field === "proposed_next_step" || input.field === "document_request";
  let instant = false;
  if (approval) {
    if (await queueFor(sql, {
      actorId: input.authorId,
      userIds: reviewerIds(),
      category: "approvals",
      siteId: input.siteId,
      summary: input.summary,
      href: proposalHref(input.siteId),
      refId: input.id,
    })) instant = true;
    if (input.ownerId && await queueFor(sql, {
      actorId: input.authorId,
      userIds: [input.ownerId],
      category: "assignments",
      siteId: input.siteId,
      summary: input.summary,
      href: proposalHref(input.siteId),
      refId: input.id,
    })) instant = true;
  }
  if (await queueFor(sql, {
    actorId: input.authorId,
    userIds: input.mentionIds,
    category: "mentions",
    siteId: input.siteId,
    summary: input.summary,
    href: discussionHref(input.siteId),
    refId: input.id,
  })) instant = true;
  const skip = new Set([input.authorId, input.ownerId || "", ...input.mentionIds, ...(approval ? reviewerIds() : [])].map((id) => id.trim().toLowerCase()));
  const followers = [...new Set([...(await followerIds(sql, input.siteId)), ...(await followAllIds(sql))])].filter((id) => !skip.has(id.trim().toLowerCase()));
  if (followers.length && await queueFor(sql, {
    actorId: input.authorId,
    userIds: followers,
    category: "proposals",
    siteId: input.siteId,
    summary: input.summary,
    href: proposalHref(input.siteId),
    refId: input.id,
  })) instant = true;
  if (instant) await flushQueued(sql);
  await ingestSuggestion(sql, input);
}

export async function notifyFlag(
  sql: Sql,
  input: { id: string; siteId: string; fromUser: string; toUser: string; note: string },
): Promise<void> {
  const instant = await queueFor(sql, {
    actorId: input.fromUser,
    userIds: [input.toUser],
    category: "flags",
    siteId: input.siteId,
    summary: input.note || "Flagged for you.",
    href: reviewHref(input.siteId),
    refId: input.id,
  });
  if (instant) await flushQueued(sql);
  await ingestFlag(sql, input);
}
