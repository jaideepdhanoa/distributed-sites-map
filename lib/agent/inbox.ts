import { randomUUID } from "node:crypto";
import { approvesWorkbookStage } from "@/lib/agent/access";
import { absoluteSiteUrl, feedOrigin } from "@/lib/agent/links";
import type { Sql } from "@/lib/actions/db";
import { fileLookup, recordField, type RecordLookup } from "@/lib/actions/records";
import { stamp, type TargetKind } from "@/lib/actions/text";
import { stageTitle } from "@/lib/labels";
import { workbookInstruction } from "@/lib/stageOverlay";

export type InboxKind = "note" | "reply" | "mention" | "suggestion" | "flag" | "decision" | "ask_gap" | "proposal_ready" | "proposal_overtaken";

export type FeedBlocker = {
  id: string;
  kind: "document_request" | "checklist" | "hold";
  label: string;
  party: string;
  askedOn: string | null;
  followUpOn: string | null;
};
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
  currentStage: string | null;
  proposalOutcome: string | null;
  openBlockers: FeedBlocker[];
  stale: boolean;
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
    currentStage: null,
    proposalOutcome: null,
    openBlockers: [],
    stale: false,
  };
}

export type FeedInsert = {
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
  createdAt?: string | null;
};

export function feedKey(kind: string, refId: string): string {
  return `${kind}:${refId}`;
}

export async function insertFeedRow(sql: Sql, input: FeedInsert): Promise<string | null> {
  const id = randomUUID();
  const saved = await sql.query<{ id: string }>(
    `INSERT INTO agent_inbox (
      id, kind, subtype, ref_id, site_id, record_id, actor, body, thread_key, thread_context,
      proposal_id, proposal_status, stage, workbook_stage, idempotency_key, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, COALESCE($16::timestamptz, now()))
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
      feedKey(input.kind, input.refId),
      input.createdAt || null,
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

export async function noteThreadContext(sql: Sql, parentId: string | null): Promise<string> {
  if (!parentId) return "";
  const rows = await sql.query<{ body: string }>(`SELECT body FROM notes WHERE id = $1`, [parentId]);
  return String(rows.rows[0]?.body || "").slice(0, 2000);
}

export function noteFeed(input: {
  noteId: string;
  siteId: string;
  recordId?: string;
  body: string;
  authorId: string;
  parentId: string | null;
  context: string;
  createdAt?: string | null;
}): FeedInsert {
  return {
    kind: input.parentId ? "reply" : "note",
    refId: input.noteId,
    siteId: input.siteId,
    recordId: input.recordId,
    actor: input.authorId,
    text: input.body,
    threadKey: `note:${input.parentId || input.noteId}`,
    threadContext: input.context,
    createdAt: input.createdAt,
  };
}

export function mentionFeed(note: FeedInsert): FeedInsert {
  return { ...note, kind: "mention" };
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
    createdAt?: string | null;
    supersede?: boolean;
  },
): Promise<void> {
  const context = await noteThreadContext(sql, input.parentId);
  const note = noteFeed({ ...input, context });
  const keep: string[] = [];
  const main = await insertFeedRow(sql, note);
  if (main) keep.push(main);
  if (input.mentionIds.length) {
    const mention = await insertFeedRow(sql, mentionFeed(note));
    if (mention) keep.push(mention);
  }
  if (input.supersede !== false) await supersedeOthers(sql, note.threadKey, keep);
}

export function suggestionFeed(input: {
  id: string;
  siteId: string;
  recordId: string;
  authorId: string;
  field: string;
  detail: string | null;
  title: string | null;
  proposedValue: string;
  reason: string;
  status: string;
  summary?: string;
  stored?: boolean;
  createdAt?: string | null;
}): FeedInsert {
  const subtype = input.detail || input.field;
  const text = input.stored
    ? [input.title, input.proposedValue, input.reason].filter(Boolean).join("\n")
    : (input.summary || "");
  const context = input.stored
    ? [input.field, subtype, input.title || ""].filter(Boolean).join(" · ")
    : (input.summary || "");
  return {
    kind: "suggestion",
    subtype,
    refId: input.id,
    siteId: input.siteId,
    recordId: input.recordId,
    actor: input.authorId,
    text,
    threadKey: `proposal:${input.id}`,
    threadContext: context,
    proposalId: input.id,
    proposalStatus: input.status,
    createdAt: input.createdAt,
  };
}

export async function ingestSuggestion(
  sql: Sql,
  input: {
    id: string;
    siteId: string;
    authorId: string;
    field: string;
    summary: string;
    createdAt?: string | null;
    supersede?: boolean;
    proposalStatus?: string;
  },
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
  const payload = suggestionFeed({
    id: input.id,
    siteId: input.siteId,
    recordId: row?.target_id || input.siteId,
    authorId: input.authorId,
    field: input.field,
    detail: row?.detail || null,
    title: row?.title || null,
    proposedValue: row?.proposed_value || "",
    reason: row?.reason || "",
    status: input.proposalStatus || row?.status || "open",
    summary: row ? undefined : input.summary,
    stored: Boolean(row),
    createdAt: input.createdAt,
  });
  const id = await insertFeedRow(sql, payload);
  if (id && input.supersede !== false) await supersedeOthers(sql, payload.threadKey, [id]);
}

export function flagFeed(input: {
  id: string;
  siteId: string;
  fromUser: string;
  toUser: string;
  note: string;
  createdAt?: string | null;
}): FeedInsert {
  return {
    kind: "flag",
    refId: input.id,
    siteId: input.siteId,
    recordId: input.siteId,
    actor: input.fromUser,
    text: input.note || "Flagged for you.",
    threadKey: `flag:${input.id}`,
    threadContext: `For ${input.toUser}`,
    createdAt: input.createdAt,
  };
}

export async function ingestFlag(
  sql: Sql,
  input: {
    id: string;
    siteId: string;
    fromUser: string;
    toUser: string;
    note: string;
    createdAt?: string | null;
    supersede?: boolean;
  },
): Promise<void> {
  const payload = flagFeed(input);
  const id = await insertFeedRow(sql, payload);
  if (id && input.supersede !== false) await supersedeOthers(sql, payload.threadKey, [id]);
}

export function proposalEventFeed(input: {
  kind: "proposal_ready" | "proposal_overtaken";
  id: string;
  actorId: string;
  note: string;
  siteId: string;
  recordId: string;
  field: string;
  detail: string | null;
  title: string | null;
  proposedValue: string;
  reason: string;
  createdAt?: string | null;
}): FeedInsert {
  const title = input.title || input.proposedValue;
  const stageLabel = input.detail === "stage_move" && input.proposedValue ? stageTitle(input.proposedValue) : "";
  const lines = input.kind === "proposal_ready"
    ? [
      `Ready: ${title}`,
      stageLabel ? `Proposed stage: ${stageLabel} (${input.proposedValue}). The stage stays until it is accepted.` : "The blockers on this proposal are clear.",
    ]
    : [
      `Closed, overtaken: ${title}`,
      input.note ? `Reason: ${input.note}` : "",
    ].filter(Boolean);
  return {
    kind: input.kind,
    subtype: input.detail || input.field,
    refId: input.id,
    siteId: input.siteId,
    recordId: input.recordId,
    actor: input.actorId,
    text: lines.join("\n"),
    threadKey: `proposal:${input.id}`,
    threadContext: [input.title, input.proposedValue, input.reason].filter(Boolean).join("\n"),
    proposalId: input.id,
    proposalStatus: input.kind === "proposal_ready" ? "ready" : "overtaken",
    createdAt: input.createdAt,
  };
}

export async function ingestProposalEvent(
  sql: Sql,
  input: {
    kind: "proposal_ready" | "proposal_overtaken";
    id: string;
    actorId: string;
    note: string;
    siteId: string;
    recordId: string;
    field: string;
    detail: string | null;
    title: string | null;
    proposedValue: string;
    reason: string;
    createdAt?: string | null;
    supersede?: boolean;
  },
): Promise<void> {
  const payload = proposalEventFeed(input);
  const id = await insertFeedRow(sql, payload);
  if (id && input.supersede !== false) await supersedeOthers(sql, payload.threadKey, [id]);
}

export function decisionFeed(input: {
  id: string;
  refId?: string;
  status: "accepted" | "rejected" | "agreed_waiting";
  actorId: string;
  note: string;
  siteId: string;
  recordId: string;
  field: string;
  detail: string | null;
  title: string | null;
  proposedValue: string;
  reason: string;
  createdAt?: string | null;
}): FeedInsert {
  const approved = workbookInstruction(input, approvesWorkbookStage(input.actorId));
  const verb = input.status === "accepted" ? "Approved" : input.status === "agreed_waiting" ? "Agreed, waiting" : "Rejected";
  const lines = [
    `${verb}: ${input.title || input.proposedValue}`,
    approved?.line || "",
    input.status === "agreed_waiting" ? "The stage is unchanged." : "",
    input.note ? `Note: ${input.note}` : "",
  ].filter(Boolean);
  return {
    kind: "decision",
    subtype: input.detail || input.field,
    refId: input.refId || input.id,
    siteId: input.siteId,
    recordId: input.recordId,
    actor: input.actorId,
    text: lines.join("\n"),
    threadKey: `proposal:${input.id}`,
    threadContext: [input.title, input.proposedValue, input.reason].filter(Boolean).join("\n"),
    proposalId: input.id,
    proposalStatus: input.status,
    stage: approved?.stage ?? null,
    workbookStage: Boolean(approved),
    createdAt: input.createdAt,
  };
}

export async function ingestDecision(
  sql: Sql,
  input: {
    id: string;
    refId?: string;
    status: "accepted" | "rejected" | "agreed_waiting";
    actorId: string;
    note: string;
    siteId: string;
    recordId: string;
    field: string;
    detail: string | null;
    title: string | null;
    proposedValue: string;
    reason: string;
    createdAt?: string | null;
    supersede?: boolean;
  },
): Promise<void> {
  const payload = decisionFeed(input);
  const id = await insertFeedRow(sql, payload);
  if (id && input.supersede !== false) await supersedeOthers(sql, payload.threadKey, [id]);
}

export async function ingestAskGap(
  sql: Sql,
  input: { userId: string; question: string; siteId: string | null },
): Promise<string> {
  const refId = randomUUID();
  const siteId = input.siteId || "portfolio";
  await insertFeedRow(sql, {
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

const PROPOSAL_KINDS = new Set<InboxKind>(["suggestion", "decision", "proposal_ready", "proposal_overtaken"]);

function dayOf(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${value.getUTCFullYear()}-${month}-${day}`;
}

async function enrichProposals(sql: Sql, items: InboxItem[], lookup: RecordLookup): Promise<InboxItem[]> {
  const ids = [...new Set(items.flatMap((item) => (PROPOSAL_KINDS.has(item.kind) ? [item.proposalId || item.refId] : [])))];
  if (!ids.length) return items;
  const marks = ids.map((_, index) => `$${index + 1}`).join(", ");
  const suggestions = await sql.query<{
    id: string;
    status: string;
    stage_at: string | null;
    target_kind: TargetKind;
    target_id: string;
  }>(
    `SELECT id, status, stage_at, target_kind, target_id FROM suggestions WHERE id IN (${marks})`,
    ids,
  );
  const byId = new Map(suggestions.rows.map((row) => [row.id, row]));
  const blockers = await sql.query<{
    id: string;
    suggestion_id: string;
    kind: FeedBlocker["kind"];
    label: string;
    party: string;
    asked_on: Date | string | null;
    follow_up_on: Date | string | null;
  }>(
    `SELECT id, suggestion_id, kind, label, party, asked_on, follow_up_on
     FROM proposal_blockers
     WHERE suggestion_id IN (${marks}) AND closed_at IS NULL
     ORDER BY created_at ASC, id ASC`,
    ids,
  );
  const open = new Map<string, FeedBlocker[]>();
  for (const row of blockers.rows) {
    const list = open.get(row.suggestion_id) || [];
    list.push({
      id: row.id,
      kind: row.kind,
      label: row.label,
      party: row.party || "",
      askedOn: dayOf(row.asked_on),
      followUpOn: dayOf(row.follow_up_on),
    });
    open.set(row.suggestion_id, list);
  }
  return items.map((item) => {
    if (!PROPOSAL_KINDS.has(item.kind)) return item;
    const id = item.proposalId || item.refId;
    const row = byId.get(id);
    const blockersFor = open.get(id) || [];
    if (!row) return { ...item, proposalOutcome: item.proposalStatus, openBlockers: blockersFor };
    const current = recordField(lookup(row.target_kind, row.target_id), "stage", null);
    const before = String(row.stage_at || "").trim().toLowerCase();
    const after = current.trim().toLowerCase();
    return {
      ...item,
      currentStage: current || null,
      proposalOutcome: row.status,
      openBlockers: blockersFor,
      stale: Boolean(before && after && before !== after),
    };
  });
}

export async function listInbox(
  sql: Sql,
  input: { after?: string | null; limit?: number; lookup?: RecordLookup } = {},
): Promise<{ items: InboxItem[]; next: string | null }> {
  const lookup = input.lookup || fileLookup();
  const { refreshProposalReadiness } = await import("@/lib/actions/blockers");
  await refreshProposalReadiness(sql, lookup);
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
  const items = await enrichProposals(sql, rows.rows.map(present), lookup);
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

export function toFeedItem(item: InboxItem, origin = feedOrigin()) {
  return {
    id: item.id,
    kind: item.kind,
    subtype: item.subtype,
    ref_id: item.refId,
    site_id: item.siteId,
    site_url: absoluteSiteUrl(origin, item.kind, item.siteId),
    actor: item.actor,
    text: item.text,
    thread: { key: item.threadKey, context: item.threadContext },
    proposal_id: item.proposalId,
    proposal_status: item.proposalStatus,
    stage: item.stage,
    workbook_stage: item.workbookStage,
    current_stage: item.currentStage,
    proposal_outcome: item.proposalOutcome,
    open_blockers: item.openBlockers.map((blocker) => ({
      id: blocker.id,
      kind: blocker.kind,
      label: blocker.label,
      party: blocker.party,
      asked_on: blocker.askedOn,
      follow_up_on: blocker.followUpOn,
    })),
    stale: item.stale,
    status: item.status,
    created_at: item.createdAt,
    cursor: item.cursor,
  };
}
