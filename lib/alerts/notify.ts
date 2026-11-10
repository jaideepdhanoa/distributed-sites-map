import { ingestFlag, ingestNote, ingestSuggestion } from "@/lib/agent/inbox";
import type { Sql } from "@/lib/actions/db";
import { resolveActionRole } from "@/lib/actions/roles";
import { loadCatalog } from "@/lib/queue/catalog";
import { getUsers } from "@/lib/users";
import { discussionHref, proposalHref, reviewHref } from "./links";
import { enqueueAlert, flushInstant } from "./deliver";
import { loadPreferences, type AlertCategory } from "./preferences";
import { deliveryRecipients } from "./recipients";

function siteLabel(siteId: string): string {
  const hit = loadCatalog().find((item) => item.id === siteId);
  const name = hit?.name?.trim();
  if (name && name !== siteId) return `${name} (${siteId})`;
  return siteId;
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
  },
): Promise<boolean> {
  const prefsCache = new Map<string, Awaited<ReturnType<typeof loadPreferences>>>();
  let instant = false;
  for (const recipient of deliveryRecipients(input.actorId, input.userIds)) {
    let prefs = prefsCache.get(recipient.userId);
    if (prefs === undefined) {
      prefs = await loadPreferences(sql, recipient.userId);
      prefsCache.set(recipient.userId, prefs);
    }
    const mode = prefs?.[input.category] || "off";
    if (mode === "off") continue;
    await enqueueAlert(sql, {
      userId: recipient.userId,
      email: recipient.email,
      category: input.category,
      channel: mode === "instant" ? "instant" : "digest",
      siteId: input.siteId,
      siteLabel: siteLabel(input.siteId),
      summary: input.summary,
      authorId: input.actorId,
      href: input.href,
      refId: input.refId,
      idempotencyKey: `${input.category}:${input.refId}:${recipient.userId}`,
    });
    if (mode === "instant") instant = true;
  }
  return instant;
}

function reviewerIds(): string[] {
  return getUsers().filter((user) => resolveActionRole(user) === "reviewer").map((user) => user.u);
}

export async function notifyNote(
  sql: Sql,
  input: { noteId: string; siteId: string; recordId?: string; body: string; authorId: string; parentId: string | null; mentionIds: string[] },
): Promise<void> {
  let instant = false;
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
      href: discussionHref(input.siteId),
      refId: input.noteId,
    })) instant = true;
  }
  if (await queueFor(sql, {
    actorId: input.authorId,
    userIds: input.mentionIds,
    category: "mentions",
    siteId: input.siteId,
    summary: input.body,
    href: discussionHref(input.siteId),
    refId: input.noteId,
  })) instant = true;
  if (instant) await flushInstant(sql);
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
  if (instant) await flushInstant(sql);
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
  if (instant) await flushInstant(sql);
  await ingestFlag(sql, input);
}
