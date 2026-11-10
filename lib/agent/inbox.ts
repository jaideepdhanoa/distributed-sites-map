import { randomUUID } from "node:crypto";
import { approvesWorkbookStage } from "@/lib/agent/access";
import type { Sql } from "@/lib/actions/db";
import { stamp } from "@/lib/actions/text";
import { stageTitle } from "@/lib/labels";

export type InboxKind = "note" | "reply" | "mention" | "suggestion" | "flag" | "decision" | "ask_gap";
export type InboxStatus = "new" | "picked" | "done" | "superseded";

export type InboxItem = {
  id: string;
  kind: InboxKind;
  subtype: string | null;
  refId: string;
  siteId: string;
  recordId: string;
  actor: string;
  text: string;
  threadKey: string;
  threadContext: string;
  proposalId: string | null;
  proposalStatus: string | null;
  stage: string | null;
  workbookStage: boolean;
  status: InboxStatus;
  createdAt: string;
  cursor: string;
};

type InboxRow = {
  id: string;
  kind: InboxKind;
  subtype: string | null;
  ref_id: string;
  site_id: string;
  record_id: string;
  actor: string;
  body: string;
  thread_key: string;
  thread_context: string;
  proposal_id: string | null;
  proposal_status: string | null;
  stage: string | null;
  workbook_stage: boolean;
  status: InboxStatus;
  created_at: Date | string;
};

export class FeedError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const SELECT = `id, kind, subtype, ref_id, site_id, record_id, actor, body, thread_key, thread_context, proposal_id, proposal_status, stage, workbook_stage, status, created_at`;

export function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, "utf8").toString("base64url");
}

export function decodeCursor(value: string): { createdAt: string; id: string } | null {
  if (!value) return null;
  let raw = "";
  try {
    raw = Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const split = raw.indexOf("|");
  if (split <= 0) return null;
  const createdAt = raw.slice(0, split);
  const id = raw.slice(split + 1);
  if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) return null;
  return { createdAt, id };
}

function present(row: InboxRow): InboxItem {
  const createdAt = stamp(row.created_at);
  return {
    id: row.id,
    kind: row.kind,
    subtype: row.subtype,
    refId: row.ref_id,
    siteId: row.site_id,
    recordId: row.record_id,
    actor: row.actor,
    text: row.body,
    threadKey: row.thread_key,
    threadContext: row.thread_context,
    proposalId: row.proposal_id,
    proposalStatus: row.proposal_status,
    stage: row.stage,
    workbookStage: Boolean(row.workbook_stage),
    status: row.status,
    createdAt,
    cursor: encodeCursor(createdAt, row.id),
  };
}

type InsertInput = {
  kind: InboxKind;
  subtype?: string | null;
  refId: string;
  siteId: string;
  recordId?: string;
  actor: string;
  text: string;
  threadKey: string;
  threadContext?: string;
  proposalId?: string | null;
  proposalStatus?: string | null;
  stage?: string | null;
  workbookStage?: boolean;
};

async function insertInbox(sql: Sql, input: InsertInput): Promise<string | null> {
  const id = randomUUID();
  const key = `${input.kind}:${input.refId}`;
  const saved = await sql.query<{ id: string }>(
    `INSERT INTO agent_inbox (
      id, kind, subtype, ref_id, site_id, record_id, actor, body, thread_key, thread_context,
      proposal_id, proposal_status, stage, workbook_stage, idempotency_key
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id`,
    [
      id,
      input.kind,
      input.subtype || null,
      input.refId,
      input.siteId,
      input.recordId || input.siteId,
      input.actor,
      input.text,
      input.threadKey,
      (input.threadContext || "").slice(0, 4000),
      input.proposalId || null,
      input.proposalStatus || null,
      input.stage || null,
      Boolean(input.workbookStage),
      key,
    ],
  );
  return saved.rows[0]?.id || null;
}

async function supersedeOthers(sql: Sql, threadKey: string, keep: string[]): Promise<void> {
  if (!keep.length) return;
  const marks = keep.map((_, index) => `$${index + 2}`).join(", ");
  await sql.query(
    `UPDATE agent_inbox SET status = 'superseded'
     WHERE thread_key = $1 AND status IN ('new', 'picked') AND id NOT IN (${marks})`,
    [threadKey, ...keep],
  );
}

async function parentBody(sql: Sql, parentId: string | null): Promise<string> {
  if (!parentId) return "";
  const rows = await sql.query<{ body: string }>(`SELECT body FROM notes WHERE id = $1`, [parentId]);
  return String(rows.rows[0]?.body || "").slice(0, 2000);
}

export async function ingestNote(
  sql: Sql,
  input: {
    noteId: string;
    siteId: string;
    recordId?: string;
    body: string;
    authorId: string;
    parentId: string | null;
    mentionIds: string[];
  },
): Promise<void> {
  const root = input.parentId || input.noteId;
  const threadKey = `note:${root}`;
  const context = input.parentId ? await parentBody(sql, input.parentId) : "";
  const keep: string[] = [];
  const main = await insertInbox(sql, {
    kind: input.parentId ? "reply" : "note",
    refId: input.noteId,
    siteId: input.siteId,
    recordId: input.recordId,
    actor: input.authorId,
    text: input.body,
    threadKey,
    threadContext: context,
  });
  if (main) keep.push(main);
  if (input.mentionIds.length) {
    const mention = await insertInbox(sql, {
      kind: "mention",
      refId: input.noteId,
      siteId: input.siteId,
      recordId: input.recordId,
      actor: input.authorId,
      text: input.body,
      threadKey,
      threadContext: context,
    });
    if (mention) keep.push(mention);
  }
  await supersedeOthers(sql, threadKey, keep);
}

export async function ingestSuggestion(
  sql: Sql,
  input: { id: string; siteId: string; authorId: string; field: string; summary: string },
): Promise<void> {
  const found = await sql.query<{
    title: string | null;
    proposed_value: string;
    reason: string;
    detail: string | null;
    status: string;
    target_id: string;
  }>(
    `SELECT title, proposed_value, reason, detail, status, target_id FROM suggestions WHERE id = $1`,
    [input.id],
  );
  const row = found.rows[0];
  const subtype = row?.detail || input.field;
  const text = row
    ? [row.title, row.proposed_value, row.reason].filter(Boolean).join("\n")
    : input.summary;
  const context = row
    ? [input.field, subtype, row.title || ""].filter(Boolean).join(" · ")
    : input.summary;
  const id = await insertInbox(sql, {
    kind: "suggestion",
    subtype,
    refId: input.id,
    siteId: input.siteId,
    recordId: row?.target_id || input.siteId,
    actor: input.authorId,
    text,
    threadKey: `proposal:${input.id}`,
    threadContext: context,
    proposalId: input.id,
    proposalStatus: row?.status || "open",
  });
  if (id) await supersedeOthers(sql, `proposal:${input.id}`, [id]);
}

export async function ingestFlag(
  sql: Sql,
  input: { id: string; siteId: string; fromUser: string; toUser: string; note: string },
): Promise<void> {
  const id = await insertInbox(sql, {
    kind: "flag",
    refId: input.id,
    siteId: input.siteId,
    recordId: input.siteId,
    actor: input.fromUser,
    text: input.note || "Flagged for you.",
    threadKey: `flag:${input.id}`,
    threadContext: `For ${input.toUser}`,
  });
  if (id) await supersedeOthers(sql, `flag:${input.id}`, [id]);
}

export async function ingestDecision(
  sql: Sql,
  input: {
    id: string;
    status: "accepted" | "rejected";
    actorId: string;
    note: string;
    siteId: string;
    recordId: string;
    field: string;
    detail: string | null;
    title: string | null;
    proposedValue: string;
    reason: string;
  },
): Promise<void> {
  const stageMove = input.detail === "stage_move" && input.status === "accepted" && approvesWorkbookStage(input.actorId);
  const stage = stageMove ? input.proposedValue : null;
  const stageLabel = stage ? stageTitle(stage) : "";
  const verb = input.status === "accepted" ? "Approved" : "Rejected";
  const lines = [
    `${verb}: ${input.title || input.proposedValue}`,
    stageLabel ? `Approved stage: ${stageLabel} (${stage}). Write this stage on the workbook Stage column.` : "",
    input.note ? `Note: ${input.note}` : "",
  ].filter(Boolean);
  const id = await insertInbox(sql, {
    kind: "decision",
    subtype: stageMove ? "stage_move" : input.detail || input.field,
    refId: input.id,
    siteId: input.siteId,
    recordId: input.recordId,
    actor: input.actorId,
    text: lines.join("\n"),
    threadKey: `proposal:${input.id}`,
    threadContext: [input.title, input.proposedValue, input.reason].filter(Boolean).join("\n"),
    proposalId: input.id,
    proposalStatus: input.status,
    stage,
    workbookStage: stageMove,
  });
  if (id) await supersedeOthers(sql, `proposal:${input.id}`, [id]);
}

export async function ingestAskGap(
  sql: Sql,
  input: { userId: string; question: string; siteId: string | null },
): Promise<string> {
  const refId = randomUUID();
  const siteId = input.siteId || "portfolio";
  await insertInbox(sql, {
    kind: "ask_gap",
    refId,
    siteId,
    recordId: siteId,
    actor: input.userId,
    text: input.question,
    threadKey: `ask:${refId}`,
    threadContext: input.siteId ? `Site ${input.siteId}` : "Portfolio and markets",
  });
  return refId;
}

export async function listInbox(sql: Sql, input: { after?: string | null; limit?: number }): Promise<{ items: InboxItem[]; next: string | null }> {
  const limit = input.limit && input.limit > 0 ? Math.min(100, Math.floor(input.limit)) : 50;
  const cursor = input.after ? decodeCursor(input.after) : null;
  if (input.after && !cursor) throw new FeedError("That cursor is not valid.");
  const rows = cursor
    ? await sql.query<InboxRow>(
      `SELECT ${SELECT} FROM agent_inbox
       WHERE (created_at, id) > ($1::timestamptz, $2)
       ORDER BY created_at ASC, id ASC
       LIMIT $3`,
      [cursor.createdAt, cursor.id, limit],
    )
    : await sql.query<InboxRow>(
      `SELECT ${SELECT} FROM agent_inbox ORDER BY created_at ASC, id ASC LIMIT $1`,
      [limit],
    );
  const items = rows.rows.map(present);
  return { items, next: items.length === limit ? items[items.length - 1].cursor : null };
}

export async function ackInbox(sql: Sql, input: { ids: string[]; status: "picked" | "done" }): Promise<number> {
  if (input.status !== "picked" && input.status !== "done") {
    throw new FeedError("Mark a row picked or done.");
  }
  const ids = [...new Set(input.ids.map((id) => id.trim()).filter(Boolean))].slice(0, 100);
  if (!ids.length) throw new FeedError("Name the rows to update.");
  let count = 0;
  for (const id of ids) {
    const saved = await sql.query<{ id: string }>(
      `UPDATE agent_inbox SET status = $2
       WHERE id = $1 AND status IN ('new', 'picked')
       RETURNING id`,
      [id, input.status],
    );
    count += saved.rows.length;
  }
  return count;
}

export function toFeedItem(item: InboxItem) {
  return {
    id: item.id,
    kind: item.kind,
    subtype: item.subtype,
    ref_id: item.refId,
    site_id: item.siteId,
    actor: item.actor,
    text: item.text,
    thread: { key: item.threadKey, context: item.threadContext },
    proposal_id: item.proposalId,
    proposal_status: item.proposalStatus,
    stage: item.stage,
    workbook_stage: item.workbookStage,
    status: item.status,
    created_at: item.createdAt,
    cursor: item.cursor,
  };
}
