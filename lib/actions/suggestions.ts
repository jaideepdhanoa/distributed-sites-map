import { randomUUID } from "node:crypto";
import { assertClean, safeSnapshot } from "@/lib/policy/banned";
import { getUsers } from "@/lib/users";
import { ingestDecision, ingestProposalEvent } from "@/lib/agent/inbox";
import { attachRecommendation } from "@/lib/agent/recommend";
import { notifySuggestion } from "@/lib/alerts/notify";
import { recordAppEvent } from "@/lib/queue/events";
import { mentionsBySource, parseMentionIds, replaceMentions, type Mention } from "./mentions";
import { audit } from "./audit";
import type { Sql } from "./db";
import { allowsAssignee, allowsDate, exportStage, normalizeNextStep } from "./nextStep";
import { parseDocumentRequest } from "@/lib/financials";
import { blockersBySuggestion, clearHoldBlocker, linkWaitingBlockers, parseHold, refreshProposalReadiness, stagesDiffer, type Blocker } from "./blockers";
import { fileLookup, recordField, valuesMatch, type RecordLookup } from "./records";
import {
  csvCell,
  InputError,
  parseBody,
  parseDate,
  parseDetail,
  parseField,
  parseTarget,
  stamp,
  type SuggestionField,
  type TargetKind,
} from "./text";

export type SuggestionStatus = "open" | "accepted" | "rejected" | "applied" | "agreed_waiting" | "ready" | "overtaken";

export type Suggestion = {
  id: string;
  targetKind: TargetKind;
  targetId: string;
  field: SuggestionField;
  detail: string | null;
  currentValue: string;
  proposedValue: string;
  reason: string;
  status: SuggestionStatus;
  authorId: string;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  appliedAt: string | null;
  title: string | null;
  targetOn: string | null;
  ownerId: string | null;
  ownerName: string | null;
  doneAt: string | null;
  doneBy: string | null;
  mentions: Mention[];
  stageAt: string | null;
  currentStage: string | null;
  stale: boolean;
  blockers: Blocker[];
};

type SuggestionRow = {
  id: string;
  target_kind: TargetKind;
  target_id: string;
  field_name: string;
  detail: string | null;
  current_value: string;
  proposed_value: string;
  reason: string;
  status: SuggestionStatus;
  author_id: string;
  created_at: Date | string;
  decided_by: string | null;
  decided_at: Date | string | null;
  applied_at: Date | string | null;
  title: string | null;
  target_on: Date | string | null;
  owner_id: string | null;
  done_at: Date | string | null;
  done_by: string | null;
  stage_at: string | null;
};

const SELECT = `id, target_kind, target_id, field_name, detail, current_value, proposed_value, reason, status, author_id, created_at, decided_by, decided_at, applied_at, title, target_on, owner_id, done_at, done_by, stage_at`;

function dayOf(value: Date | string | null): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${value.getUTCFullYear()}-${month}-${day}`;
}

function ownerName(id: string | null): string | null {
  if (!id) return null;
  const account = getUsers().find((user) => user.u === id);
  if (!account) return id;
  const named = safeSnapshot(account.displayName, 80);
  return named || account.u;
}

function present(row: SuggestionRow): Suggestion | null {
  const proposedValue = safeSnapshot(row.proposed_value, 500);
  const reason = safeSnapshot(row.reason, 2000);
  const title = safeSnapshot(row.title || "", 120) || null;
  if (!proposedValue) return null;
  if (!reason && row.field_name !== "proposed_next_step") return null;
  return {
    id: row.id,
    targetKind: row.target_kind,
    targetId: row.target_id,
    field: row.field_name as SuggestionField,
    detail: row.detail,
    currentValue: safeSnapshot(row.current_value, 500),
    proposedValue,
    reason,
    status: row.status,
    authorId: row.author_id,
    createdAt: stamp(row.created_at),
    decidedBy: row.decided_by,
    decidedAt: row.decided_at ? stamp(row.decided_at) : null,
    appliedAt: row.applied_at ? stamp(row.applied_at) : null,
    title,
    targetOn: dayOf(row.target_on),
    ownerId: row.owner_id,
    ownerName: ownerName(row.owner_id),
    doneAt: row.done_at ? stamp(row.done_at) : null,
    doneBy: row.done_by,
    mentions: [],
    stageAt: row.stage_at || null,
    currentStage: null,
    stale: false,
    blockers: [],
  };
}

async function decorate(sql: Sql, rows: Suggestion[], lookup: RecordLookup): Promise<Suggestion[]> {
  const mentioned = await withMentions(sql, rows);
  const blockers = await blockersBySuggestion(sql, mentioned.map((row) => row.id));
  return mentioned.map((row) => {
    const current = recordField(lookup(row.targetKind, row.targetId), "stage", null);
    return {
      ...row,
      currentStage: current || null,
      stale: stagesDiffer(row.stageAt, current),
      blockers: blockers.get(row.id) || [],
    };
  });
}

async function withMentions(sql: Sql, rows: Suggestion[]): Promise<Suggestion[]> {
  const map = await mentionsBySource(sql, "suggestion", rows.map((row) => row.id));
  return rows.map((row) => ({ ...row, mentions: map.get(row.id) || [] }));
}

export function permanentSiteId(kind: TargetKind, id: string, lookup: RecordLookup = fileLookup()): string {
  const record = lookup(kind, id);
  if (!record) return id;
  if (kind === "deal") return String(record.deal_id || id);
  const linked = String(record.linked_deal_id || "");
  if (/^(PIPE|LAND)-[A-Z]{2,4}-\d{4}$/.test(linked)) return linked;
  return id;
}

export async function listSuggestions(
  sql: Sql,
  filter?: { targetKind?: TargetKind; targetId?: string; status?: SuggestionStatus },
  lookup: RecordLookup = fileLookup(),
): Promise<Suggestion[]> {
  await refreshProposalReadiness(sql, lookup);
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (filter?.targetKind && filter.targetId) {
    values.push(filter.targetKind, filter.targetId);
    clauses.push(`target_kind = $${values.length - 1} AND target_id = $${values.length}`);
  }
  if (filter?.status) {
    values.push(filter.status);
    clauses.push(`status = $${values.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await sql.query<SuggestionRow>(
    `SELECT ${SELECT} FROM suggestions ${where} ORDER BY created_at DESC, id DESC`,
    values,
  );
  const suggestions = rows.rows.map(present).filter((row): row is Suggestion => Boolean(row));
  return decorate(sql, suggestions, lookup);
}

export async function createSuggestion(
  sql: Sql,
  input: {
    targetKind: TargetKind;
    targetId: string;
    field: string;
    detail?: string | null;
    proposedValue: string;
    reason: string;
    authorId: string;
    title?: string | null;
    targetOn?: string | null;
    ownerId?: string | null;
    mentions?: unknown;
  },
  lookup: RecordLookup = fileLookup(),
): Promise<Suggestion> {
  const target = parseTarget(input.targetKind, input.targetId);
  const record = lookup(target.targetKind, target.targetId);
  if (!record) throw new InputError("That site or deal is not on the map.", 404);
  const field = parseField(input.field);
  const parsedDetail = parseDetail(field, input.detail);
  const nextStep = field === "proposed_next_step";
  const normalized = nextStep
    ? normalizeNextStep({
      detail: parsedDetail,
      title: input.title,
      proposedValue: input.proposedValue,
      reason: input.reason,
      targetOn: input.targetOn,
      ownerId: input.ownerId,
    }, getUsers())
    : null;
  const title = normalized ? normalized.title : null;
  let proposedValue = normalized ? normalized.proposedValue : parseBody(input.proposedValue, "proposed value", 500);
  let reason = normalized ? normalized.reason : parseBody(input.reason, "reason", 2000);
  let targetOn = normalized ? normalized.targetOn : null;
  let ownerId = normalized ? normalized.ownerId : null;
  const detail = normalized ? normalized.detail : parsedDetail;
  if (field === "document_request") {
    const request = parseDocumentRequest(proposedValue);
    if (!request) throw new InputError("Choose the missing checklist items.");
    const owner = String(input.ownerId || "").trim().toLowerCase();
    if (!owner || !getUsers().some((user) => user.u === owner)) throw new InputError("Name one owner.");
    ownerId = owner;
    targetOn = input.targetOn ? parseDate(input.targetOn) : null;
    if (request.reason) reason = parseBody(request.reason, "reason", 2000);
    proposedValue = JSON.stringify({ mode: request.mode, items: request.items, reason });
    assertClean(proposedValue);
    assertClean(reason);
  }
  if (!normalized) {
    assertClean(proposedValue);
    if (reason) assertClean(reason);
  }
  const mentionIds = nextStep ? parseMentionIds(input.mentions) : [];
  const id = randomUUID();
  const currentValue = nextStep ? "" : safeSnapshot(recordField(record, field, detail));
  const stageAt = recordField(record, "stage", null);
  await sql.query(
    `INSERT INTO suggestions (
      id, target_kind, target_id, field_name, detail, current_value, proposed_value, reason, status, author_id, title, target_on, owner_id, stage_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open', $9, $10, $11, $12, $13)`,
    [id, target.targetKind, target.targetId, field, detail, currentValue, proposedValue, reason, input.authorId, title, targetOn, ownerId, stageAt || null],
  );
  await audit(sql, {
    actorId: input.authorId,
    action: "suggestion.create",
    targetKind: target.targetKind,
    targetId: target.targetId,
    after: { id, field, detail, currentValue, proposedValue, reason, status: "open", title, targetOn, ownerId },
  });
  const siteId = permanentSiteId(target.targetKind, target.targetId, lookup);
  if (field === "document_request") {
    await recordAppEvent(sql, {
      siteId,
      type: "document_request",
      summary: "Request documents",
      actorId: input.authorId,
      refId: id,
    });
  }
  if (nextStep && mentionIds.length) {
    await replaceMentions(sql, { userIds: mentionIds, siteId, sourceKind: "suggestion", sourceId: id });
  }
  if (nextStep && title) {
    await recordAppEvent(sql, {
      siteId,
      type: "next_proposed",
      summary: `Next step proposed: ${title}`,
      actorId: input.authorId,
      refId: id,
    });
  }
  await notifySuggestion(sql, {
    id,
    siteId,
    authorId: input.authorId,
    field,
    summary: title || (field === "document_request" ? "Request documents" : proposedValue),
    ownerId,
    mentionIds,
  });
  const saved = await sql.query<SuggestionRow>(`SELECT ${SELECT} FROM suggestions WHERE id = $1`, [id]);
  const suggestion = present(saved.rows[0]);
  if (!suggestion) throw new InputError("That suggestion could not be saved.");
  return (await decorate(sql, [suggestion], lookup))[0];
}

const DECISION_ACTION = {
  accepted: "suggestion.accept",
  rejected: "suggestion.reject",
  agreed_waiting: "suggestion.agree_waiting",
  overtaken: "suggestion.overtaken",
} as const;

export async function decideSuggestion(
  sql: Sql,
  input: {
    id: string;
    status: "accepted" | "rejected" | "agreed_waiting" | "overtaken";
    actorId: string;
    note?: string;
    reply?: string;
    recommendationId?: string | null;
    hold?: unknown;
  },
  lookup: RecordLookup = fileLookup(),
): Promise<Suggestion> {
  if (input.status !== "accepted" && input.status !== "rejected" && input.status !== "agreed_waiting" && input.status !== "overtaken") {
    throw new InputError("Choose accept, reject, agreed and waiting, or closed as overtaken.");
  }
  const reply = input.reply?.trim() ? parseBody(input.reply, "reply", 2000) : "";
  const note = input.note?.trim() ? parseBody(input.note, "note", 2000) : reply;
  if (reply) assertClean(reply);
  if (note && note !== reply) assertClean(note);
  if (input.status === "overtaken" && !note) throw new InputError("Add the reason.");
  if (input.status === "agreed_waiting" && !note) throw new InputError("Tell the proposer what you are waiting on.");
  const hold = input.status === "agreed_waiting" ? parseHold(input.hold) : null;
  const existing = await sql.query<SuggestionRow>(`SELECT ${SELECT} FROM suggestions WHERE id = $1`, [input.id]);
  const row = existing.rows[0];
  if (!row) throw new InputError("That suggestion is not in the queue.", 404);
  const open = row.status === "open";
  const waiting = row.status === "agreed_waiting";
  const ready = row.status === "ready";
  if (input.status === "agreed_waiting" && !open) throw new InputError("Only an open proposal can be marked waiting.");
  if (input.status === "accepted" && waiting) throw new InputError("That proposal is waiting on blockers.");
  if (input.status === "accepted" && !open && !ready) throw new InputError("Only an open suggestion can be accepted or rejected.");
  if ((input.status === "rejected" || input.status === "overtaken") && !open && !waiting && !ready) {
    throw new InputError("Only an open suggestion can be accepted or rejected.");
  }
  if (input.status === "agreed_waiting") {
    const linked = await linkWaitingBlockers(sql, {
      suggestionId: row.id,
      kind: row.target_kind,
      id: row.target_id,
      hold,
    }, lookup);
    if (!linked) throw new InputError("Name what this is waiting on.");
  }
  const attached = await attachRecommendation(sql, {
    recommendationId: input.recommendationId,
    actorId: input.actorId,
    kind: "decision",
  });
  const from = input.status === "accepted" ? ["open", "ready"] : input.status === "agreed_waiting" ? ["open"] : ["open", "agreed_waiting", "ready"];
  const updated = await sql.query(
    `UPDATE suggestions
     SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4,
         recommendation_id = $5, drafted_by_agent = $6
     WHERE id = $1 AND status = ANY($7::text[])
     RETURNING id`,
    [input.id, input.status, input.actorId, note || null, attached.recommendationId, attached.draftedByAgent, from],
  );
  if (!updated.rows.length) throw new InputError("Only an open suggestion can be accepted or rejected.");
  await audit(sql, {
    actorId: input.actorId,
    action: DECISION_ACTION[input.status],
    targetKind: row.target_kind,
    targetId: row.target_id,
    before: { id: row.id, status: row.status },
    after: { id: row.id, status: input.status, note, recommendationId: attached.recommendationId, draftedByAgent: attached.draftedByAgent },
  });
  const siteId = permanentSiteId(row.target_kind, row.target_id, lookup);
  if (input.status === "overtaken") {
    await ingestProposalEvent(sql, {
      kind: "proposal_overtaken",
      id: input.id,
      actorId: input.actorId,
      note,
      siteId,
      recordId: row.target_id,
      field: row.field_name,
      detail: row.detail,
      title: row.title,
      proposedValue: row.proposed_value,
      reason: row.reason,
    });
  } else {
    await ingestDecision(sql, {
      id: input.id,
      refId: input.status === "agreed_waiting" ? `${input.id}:waiting` : input.id,
      status: input.status,
      actorId: input.actorId,
      note,
      siteId,
      recordId: row.target_id,
      field: row.field_name,
      detail: row.detail,
      title: row.title,
      proposedValue: row.proposed_value,
      reason: row.reason,
    });
  }
  if (reply) {
    const { createNote } = await import("./notes");
    const mention = row.author_id !== input.actorId && getUsers().some((user) => user.u === row.author_id) ? [row.author_id] : [];
    await createNote(sql, {
      targetKind: "suggestion",
      targetId: row.id,
      body: reply,
      authorId: input.actorId,
      mentions: mention,
    }, lookup);
  }
  if (input.status === "accepted" && row.field_name === "document_request" && row.target_on) {
    const day = dayOf(row.target_on);
    const siteId = permanentSiteId(row.target_kind, row.target_id);
    if (day && siteId) {
      await sql.query(
        `INSERT INTO queue_snoozes (user_id, site_id, until_date) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, site_id) DO UPDATE SET until_date = EXCLUDED.until_date`,
        [input.actorId, siteId, day],
      );
    }
  }
  if (row.field_name === "proposed_next_step" && (input.status === "accepted" || input.status === "rejected")) {
    const title = safeSnapshot(row.title || row.proposed_value, 120);
    if (title) {
      await recordAppEvent(sql, {
        siteId: permanentSiteId(row.target_kind, row.target_id, lookup),
        type: input.status === "accepted" ? "next_accepted" : "next_rejected",
        summary: input.status === "accepted" ? `Next step approved: ${title}` : `Next step rejected: ${title}`,
        actorId: input.actorId,
        refId: row.id,
      });
    }
  }
  await refreshProposalReadiness(sql, lookup);
  const saved = await sql.query<SuggestionRow>(`SELECT ${SELECT} FROM suggestions WHERE id = $1`, [input.id]);
  const suggestion = present(saved.rows[0]);
  if (!suggestion) throw new InputError("That suggestion could not be updated.");
  return (await decorate(sql, [suggestion], lookup))[0];
}

export async function clearSuggestionBlocker(
  sql: Sql,
  input: { id: string; blockerId: string; actorId: string },
  lookup: RecordLookup = fileLookup(),
): Promise<Suggestion> {
  await clearHoldBlocker(sql, { suggestionId: input.id, blockerId: input.blockerId, actorId: input.actorId }, lookup);
  const saved = await sql.query<SuggestionRow>(`SELECT ${SELECT} FROM suggestions WHERE id = $1`, [input.id]);
  const suggestion = present(saved.rows[0]);
  if (!suggestion) throw new InputError("That suggestion could not be updated.");
  return (await decorate(sql, [suggestion], lookup))[0];
}

export async function completeSuggestion(
  sql: Sql,
  input: { id: string; actorId: string; reviewer: boolean },
): Promise<Suggestion> {
  const existing = await sql.query<SuggestionRow>(`SELECT ${SELECT} FROM suggestions WHERE id = $1`, [input.id]);
  const row = existing.rows[0];
  if (!row || row.field_name !== "proposed_next_step") throw new InputError("That next step is not in the queue.", 404);
  if (row.status !== "open" && row.status !== "accepted") throw new InputError("Only an open or approved next step can be marked done.");
  if (row.done_at) throw new InputError("That next step is already done.");
  if (row.owner_id !== input.actorId && !input.reviewer) throw new InputError("You do not have permission for that.", 403);
  await sql.query(`UPDATE suggestions SET done_at = now(), done_by = $2 WHERE id = $1 AND done_at IS NULL`, [input.id, input.actorId]);
  await audit(sql, {
    actorId: input.actorId,
    action: "suggestion.done",
    targetKind: row.target_kind,
    targetId: row.target_id,
    before: { id: row.id, done: false },
    after: { id: row.id, done: true },
  });
  const saved = await sql.query<SuggestionRow>(`SELECT ${SELECT} FROM suggestions WHERE id = $1`, [input.id]);
  const suggestion = present(saved.rows[0]);
  if (!suggestion) throw new InputError("That next step could not be updated.");
  return (await withMentions(sql, [suggestion]))[0];
}

export async function reviseSuggestion(
  sql: Sql,
  input: {
    id: string;
    actorId: string;
    reviewer: boolean;
    title?: string | null;
    proposedValue?: string | null;
    reason?: string | null;
    detail?: string | null;
    targetOn?: string | null;
    ownerId?: string | null;
  },
): Promise<Suggestion> {
  const existing = await sql.query<SuggestionRow>(`SELECT ${SELECT} FROM suggestions WHERE id = $1`, [input.id]);
  const row = existing.rows[0];
  if (!row || row.field_name !== "proposed_next_step") throw new InputError("That next step is not in the queue.", 404);
  if (row.done_at) throw new InputError("That next step is already done.");
  if (row.status === "accepted") {
    if (!input.reviewer && row.owner_id !== input.actorId && row.author_id !== input.actorId) {
      throw new InputError("You do not have permission for that.", 403);
    }
    const date = allowsDate(row.detail) ? parseDate(input.targetOn === undefined ? dayOf(row.target_on) : input.targetOn) : null;
    let owner: string | null = null;
    if (allowsAssignee(row.detail)) {
      owner = input.ownerId === undefined ? row.owner_id : (String(input.ownerId || "").trim().toLowerCase() || null);
      if (owner && !getUsers().some((user) => user.u === owner)) throw new InputError("Choose an account from the list.");
    }
    await sql.query(`UPDATE suggestions SET target_on = $2, owner_id = $3 WHERE id = $1`, [input.id, date, owner]);
    await audit(sql, {
      actorId: input.actorId,
      action: "suggestion.revise",
      targetKind: row.target_kind,
      targetId: row.target_id,
      before: { id: row.id, targetOn: dayOf(row.target_on), ownerId: row.owner_id },
      after: { id: row.id, targetOn: date, ownerId: owner },
    });
  } else if (row.status === "open") {
    if (!input.reviewer && row.author_id !== input.actorId) throw new InputError("You do not have permission for that.", 403);
    const normalized = normalizeNextStep({
      detail: input.detail === undefined ? row.detail : input.detail,
      title: input.title === undefined ? row.title : input.title,
      proposedValue: input.proposedValue === undefined ? row.proposed_value : input.proposedValue,
      reason: input.reason === undefined ? row.reason : input.reason,
      targetOn: input.targetOn === undefined ? dayOf(row.target_on) : input.targetOn,
      ownerId: input.ownerId === undefined ? row.owner_id : input.ownerId,
    }, getUsers());
    await sql.query(
      `UPDATE suggestions SET detail = $2, title = $3, proposed_value = $4, reason = $5, target_on = $6, owner_id = $7 WHERE id = $1 AND status = 'open'`,
      [input.id, normalized.detail, normalized.title, normalized.proposedValue, normalized.reason, normalized.targetOn, normalized.ownerId],
    );
    await audit(sql, {
      actorId: input.actorId,
      action: "suggestion.revise",
      targetKind: row.target_kind,
      targetId: row.target_id,
      before: { id: row.id, status: "open" },
      after: { id: row.id, title: normalized.title, detail: normalized.detail },
    });
  } else {
    throw new InputError("Only an open or approved next step can be edited.");
  }
  const saved = await sql.query<SuggestionRow>(`SELECT ${SELECT} FROM suggestions WHERE id = $1`, [input.id]);
  const suggestion = present(saved.rows[0]);
  if (!suggestion) throw new InputError("That next step could not be updated.");
  return (await withMentions(sql, [suggestion]))[0];
}

export async function reconcileSuggestions(sql: Sql, lookup: RecordLookup = fileLookup()): Promise<number> {
  const rows = await sql.query<SuggestionRow>(
    `SELECT ${SELECT} FROM suggestions WHERE status IN ('open', 'accepted')`,
  );
  let applied = 0;
  for (const row of rows.rows) {
    const record = lookup(row.target_kind, row.target_id);
    if (!valuesMatch(row.field_name, row.detail, row.proposed_value, record)) continue;
    const updated = await sql.query(
      `UPDATE suggestions SET status = 'applied', applied_at = now()
       WHERE id = $1 AND status IN ('open', 'accepted') RETURNING id`,
      [row.id],
    );
    if (!updated.rows.length) continue;
    await audit(sql, {
      actorId: "system",
      action: "suggestion.applied",
      targetKind: row.target_kind,
      targetId: row.target_id,
      before: { id: row.id, status: row.status },
      after: { id: row.id, status: "applied" },
    });
    applied += 1;
  }
  return applied;
}

export function suggestionsCsv(rows: Suggestion[]): string {
  const headers = [
    "id",
    "target_kind",
    "target_id",
    "field",
    "detail",
    "current_value",
    "proposed_value",
    "reason",
    "status",
    "author_id",
    "created_at",
    "decided_by",
    "decided_at",
    "applied_at",
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.targetKind,
        row.targetId,
        row.field,
        row.detail,
        row.currentValue,
        row.proposedValue,
        row.reason,
        row.status,
        row.authorId,
        row.createdAt,
        row.decidedBy,
        row.decidedAt,
        row.appliedAt,
      ].map(csvCell).join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function nextStepsCsv(rows: Suggestion[], lookup: RecordLookup = fileLookup()): string {
  const headers = ["site_id", "date", "title", "owner", "approved_at", "done_at", "type", "stage"];
  const lines = [headers.join(",")];
  const approved = rows
    .filter((row) => row.field === "proposed_next_step" && row.status === "accepted")
    .sort((a, b) => (a.decidedAt || "").localeCompare(b.decidedAt || ""));
  for (const row of approved) {
    lines.push(
      [
        permanentSiteId(row.targetKind, row.targetId, lookup),
        row.targetOn,
        row.title || row.proposedValue,
        row.ownerName,
        row.decidedAt,
        row.doneAt,
        row.detail || "work_item",
        exportStage(row.detail, row.proposedValue),
      ].map(csvCell).join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}
