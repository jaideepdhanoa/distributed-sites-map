import { randomUUID } from "node:crypto";
import { audit } from "@/lib/actions/audit";
import type { Sql } from "@/lib/actions/db";
import { fileLookup, recordField, type RecordLookup } from "@/lib/actions/records";
import { InputError, parseBody, parseDate, type TargetKind } from "@/lib/actions/text";
import { ingestProposalEvent } from "@/lib/agent/inbox";
import { checklistLabel, parseDocumentRequest, type ChecklistRow } from "@/lib/financials";
import { assertClean } from "@/lib/policy/banned";
import type { DealProps } from "@/lib/types";

export type BlockerKind = "document_request" | "checklist" | "hold";

export type Blocker = {
  id: string;
  suggestionId: string;
  kind: BlockerKind;
  refId: string;
  label: string;
  party: string;
  askedOn: string | null;
  followUpOn: string | null;
  closed: boolean;
};

export type OpenNeed = {
  kind: BlockerKind;
  refId: string;
  label: string;
  party: string;
  askedOn: string | null;
  followUpOn: string | null;
};

export type HoldInput = {
  label: string;
  party: string;
  askedOn: string | null;
  followUpOn: string | null;
};

type BlockerRow = {
  id: string;
  suggestion_id: string;
  kind: BlockerKind;
  ref_id: string;
  label: string;
  party: string;
  asked_on: Date | string | null;
  follow_up_on: Date | string | null;
  closed_at: Date | string | null;
};

type WaitingRow = {
  id: string;
  target_kind: TargetKind;
  target_id: string;
  field_name: string;
  detail: string | null;
  title: string | null;
  proposed_value: string;
  reason: string;
  author_id: string;
};

const SITE_ID = /^(PIPE|LAND)-[A-Z]{2,4}-\d{4}$/;

function dayOf(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${value.getUTCFullYear()}-${month}-${day}`;
}

export function siteKey(kind: TargetKind, id: string, lookup: RecordLookup): string {
  const record = lookup(kind, id);
  if (!record) return id;
  if (kind === "deal") return String(record.deal_id || id);
  const linked = String(record.linked_deal_id || "");
  if (SITE_ID.test(linked)) return linked;
  return id;
}

export function checklistIsOpen(state: string): boolean {
  const value = state.trim().toLowerCase();
  if (!value) return false;
  if (value === "on file" || value === "not available") return false;
  return true;
}

export function stagesDiffer(thenStage: string | null | undefined, nowStage: string | null | undefined): boolean {
  const before = String(thenStage || "").trim().toLowerCase();
  const after = String(nowStage || "").trim().toLowerCase();
  if (!before || !after) return false;
  return before !== after;
}

function dealRecord(kind: TargetKind, id: string, lookup: RecordLookup): Record<string, unknown> | null {
  if (kind === "deal") return lookup("deal", id);
  const linked = siteKey("site", id, lookup);
  return lookup("deal", linked) || lookup(kind, id);
}

function rowsFromRecord(record: Record<string, unknown> | null): ChecklistRow[] | null {
  if (!record || !Array.isArray(record.checklist)) return null;
  return record.checklist.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const id = String(row.id || "").trim();
    if (!id) return [];
    return [{
      id,
      state: String(row.state || "Not asked yet").trim() || "Not asked yet",
      since: String(row.since || "").trim(),
      why: String(row.why || "").trim(),
      period: String(row.period || "").trim(),
      href: "",
      owner: String(row.owner || "").trim(),
      receivedOn: String(row.receivedOn || row.received_on || "").trim(),
      note: String(row.note || "").trim(),
    }];
  });
}

async function checklistFor(kind: TargetKind, id: string, lookup: RecordLookup): Promise<ChecklistRow[]> {
  const record = dealRecord(kind, id, lookup);
  const inline = rowsFromRecord(record);
  if (inline) return inline;
  if (!record) return [];
  try {
    const { loadFinancialPanel } = await import("@/lib/financialsLoad");
    return loadFinancialPanel(record as unknown as DealProps, true).checklist;
  } catch {
    return [];
  }
}

function documentLabel(proposed: string, reason: string): string {
  const parsed = parseDocumentRequest(proposed);
  if (!parsed) return reason || "Document request";
  if (parsed.mode === "package_refused") return "Package unavailable";
  const names = parsed.items.map((item) => checklistLabel(item)).join(", ");
  if (parsed.mode === "refused") return names ? `Not available: ${names}` : "Not available";
  return names ? names : "Document request";
}

function presentBlocker(row: BlockerRow): Blocker {
  return {
    id: row.id,
    suggestionId: row.suggestion_id,
    kind: row.kind,
    refId: row.ref_id,
    label: row.label,
    party: row.party || "",
    askedOn: dayOf(row.asked_on),
    followUpOn: dayOf(row.follow_up_on),
    closed: Boolean(row.closed_at),
  };
}

export function parseHold(value: unknown): HoldInput | null {
  if (value == null) return null;
  if (!value || typeof value !== "object") throw new InputError("Name the hold.");
  const row = value as Record<string, unknown>;
  const label = String(row.label || "").trim();
  const party = String(row.party || "").trim();
  if (!label && !party && !row.askedOn && !row.followUpOn) return null;
  if (!label) throw new InputError("Name the hold.");
  if (party.length > 120) throw new InputError("Name who it is from in 120 characters or fewer.");
  const text = parseBody(label, "blocker", 200);
  assertClean(text);
  if (party) assertClean(party);
  return {
    label: text,
    party,
    askedOn: row.askedOn ? parseDate(row.askedOn) : null,
    followUpOn: row.followUpOn ? parseDate(row.followUpOn) : null,
  };
}

async function openDocumentNeeds(sql: Sql, kind: TargetKind, id: string, lookup: RecordLookup): Promise<OpenNeed[]> {
  const site = siteKey(kind, id, lookup);
  const rows = await sql.query<{
    id: string;
    target_kind: TargetKind;
    target_id: string;
    proposed_value: string;
    reason: string;
    owner_id: string | null;
    target_on: Date | string | null;
    created_at: Date | string;
  }>(
    `SELECT id, target_kind, target_id, proposed_value, reason, owner_id, target_on, created_at
     FROM suggestions
     WHERE field_name = 'document_request' AND status = 'open'`,
  );
  const needs: OpenNeed[] = [];
  for (const row of rows.rows) {
    if (siteKey(row.target_kind, row.target_id, lookup) !== site && !(row.target_kind === kind && row.target_id === id)) continue;
    needs.push({
      kind: "document_request",
      refId: row.id,
      label: documentLabel(row.proposed_value, row.reason),
      party: row.owner_id || "",
      askedOn: dayOf(row.created_at),
      followUpOn: dayOf(row.target_on),
    });
  }
  return needs;
}

async function checklistNeeds(kind: TargetKind, id: string, lookup: RecordLookup): Promise<OpenNeed[]> {
  const rows = await checklistFor(kind, id, lookup);
  return rows.flatMap((item) => {
    if (!item.id || !checklistIsOpen(item.state)) return [];
    return [{
      kind: "checklist" as const,
      refId: item.id,
      label: checklistLabel(item.id),
      party: item.owner || "",
      askedOn: dayOf(item.since) || (/^\d{4}-\d{2}-\d{2}/.test(item.since) ? item.since.slice(0, 10) : null),
      followUpOn: null,
    }];
  });
}

export async function listOpenNeeds(sql: Sql, kind: TargetKind, id: string, lookup: RecordLookup = fileLookup()): Promise<OpenNeed[]> {
  const documents = await openDocumentNeeds(sql, kind, id, lookup);
  return [...documents, ...(await checklistNeeds(kind, id, lookup))];
}

async function insertNeed(sql: Sql, suggestionId: string, need: OpenNeed): Promise<void> {
  await sql.query(
    `INSERT INTO proposal_blockers (id, suggestion_id, kind, ref_id, label, party, asked_on, follow_up_on)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (suggestion_id, kind, ref_id) DO NOTHING`,
    [randomUUID(), suggestionId, need.kind, need.refId, need.label, need.party, need.askedOn, need.followUpOn],
  );
}

export async function linkWaitingBlockers(
  sql: Sql,
  input: { suggestionId: string; kind: TargetKind; id: string; hold: HoldInput | null },
  lookup: RecordLookup = fileLookup(),
): Promise<number> {
  const needs = await listOpenNeeds(sql, input.kind, input.id, lookup);
  for (const need of needs) await insertNeed(sql, input.suggestionId, need);
  if (input.hold) {
    await insertNeed(sql, input.suggestionId, {
      kind: "hold",
      refId: randomUUID(),
      label: input.hold.label,
      party: input.hold.party,
      askedOn: input.hold.askedOn,
      followUpOn: input.hold.followUpOn,
    });
  }
  const saved = await sql.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM proposal_blockers WHERE suggestion_id = $1`,
    [input.suggestionId],
  );
  return Number(saved.rows[0]?.n || 0);
}

export async function blockersBySuggestion(sql: Sql, suggestionIds: string[]): Promise<Map<string, Blocker[]>> {
  const map = new Map<string, Blocker[]>();
  if (!suggestionIds.length) return map;
  const marks = suggestionIds.map((_, index) => `$${index + 1}`).join(", ");
  const rows = await sql.query<BlockerRow>(
    `SELECT id, suggestion_id, kind, ref_id, label, party, asked_on, follow_up_on, closed_at
     FROM proposal_blockers
     WHERE suggestion_id IN (${marks})
     ORDER BY created_at ASC, id ASC`,
    suggestionIds,
  );
  for (const row of rows.rows) {
    const list = map.get(row.suggestion_id) || [];
    list.push(presentBlocker(row));
    map.set(row.suggestion_id, list);
  }
  return map;
}

async function closeResolvedBlockers(sql: Sql, lookup: RecordLookup): Promise<void> {
  const rows = await sql.query<{
    id: string;
    suggestion_id: string;
    kind: BlockerKind;
    ref_id: string;
    target_kind: TargetKind;
    target_id: string;
  }>(
    `SELECT b.id, b.suggestion_id, b.kind, b.ref_id, s.target_kind, s.target_id
     FROM proposal_blockers b
     JOIN suggestions s ON s.id = b.suggestion_id
     WHERE b.closed_at IS NULL AND s.status = 'agreed_waiting' AND b.kind <> 'hold'`,
  );
  const docIds = rows.rows.filter((row) => row.kind === "document_request").map((row) => row.ref_id);
  const docStatus = new Map<string, string>();
  if (docIds.length) {
    const marks = docIds.map((_, index) => `$${index + 1}`).join(", ");
    const docs = await sql.query<{ id: string; status: string }>(
      `SELECT id, status FROM suggestions WHERE id IN (${marks})`,
      docIds,
    );
    for (const doc of docs.rows) docStatus.set(doc.id, doc.status);
  }
  const checklistCache = new Map<string, ChecklistRow[]>();
  for (const row of rows.rows) {
    let closed = false;
    if (row.kind === "document_request") {
      const status = docStatus.get(row.ref_id);
      closed = !status || status !== "open";
    } else if (row.kind === "checklist") {
      const key = `${row.target_kind}:${row.target_id}`;
      let items = checklistCache.get(key);
      if (!items) {
        items = await checklistFor(row.target_kind, row.target_id, lookup);
        checklistCache.set(key, items);
      }
      const item = items.find((entry) => entry.id === row.ref_id);
      if (item) closed = !checklistIsOpen(item.state);
    }
    if (!closed) continue;
    await sql.query(`UPDATE proposal_blockers SET closed_at = now() WHERE id = $1 AND closed_at IS NULL`, [row.id]);
  }
}

async function signalMissing(sql: Sql, lookup: RecordLookup): Promise<void> {
  const rows = await sql.query<WaitingRow & { status: string; decided_by: string | null; decision_note: string | null }>(
    `SELECT s.id, s.target_kind, s.target_id, s.field_name, s.detail, s.title, s.proposed_value, s.reason, s.author_id,
            s.status, s.decided_by, s.decision_note
     FROM suggestions s
     WHERE s.status IN ('ready', 'overtaken')
       AND NOT EXISTS (
         SELECT 1 FROM agent_inbox i
         WHERE i.idempotency_key = CASE
           WHEN s.status = 'ready' THEN 'proposal_ready:' || s.id
           ELSE 'proposal_overtaken:' || s.id
         END
       )`,
  );
  for (const row of rows.rows) {
    const kind = row.status === "ready" ? "proposal_ready" : "proposal_overtaken";
    await ingestProposalEvent(sql, {
      kind,
      id: row.id,
      actorId: kind === "proposal_ready" ? "system" : (row.decided_by || row.author_id),
      note: row.decision_note || "",
      siteId: siteKey(row.target_kind, row.target_id, lookup),
      recordId: row.target_id,
      field: row.field_name,
      detail: row.detail,
      title: row.title,
      proposedValue: row.proposed_value,
      reason: row.reason,
    });
  }
}

/** Close resolved blockers and mark a waiting proposal ready once none remain. */
export async function refreshProposalReadiness(sql: Sql, lookup: RecordLookup = fileLookup()): Promise<number> {
  await closeResolvedBlockers(sql, lookup);
  const waiting = await sql.query<WaitingRow>(
    `SELECT id, target_kind, target_id, field_name, detail, title, proposed_value, reason, author_id
     FROM suggestions WHERE status = 'agreed_waiting'`,
  );
  let ready = 0;
  for (const row of waiting.rows) {
    const open = await sql.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM proposal_blockers WHERE suggestion_id = $1 AND closed_at IS NULL`,
      [row.id],
    );
    if (Number(open.rows[0]?.n || 0) > 0) continue;
    const updated = await sql.query<{ id: string }>(
      `UPDATE suggestions SET status = 'ready' WHERE id = $1 AND status = 'agreed_waiting' RETURNING id`,
      [row.id],
    );
    if (!updated.rows.length) continue;
    await audit(sql, {
      actorId: "system",
      action: "suggestion.ready",
      targetKind: row.target_kind,
      targetId: row.target_id,
      before: { id: row.id, status: "agreed_waiting" },
      after: { id: row.id, status: "ready" },
    });
    ready += 1;
  }
  await signalMissing(sql, lookup);
  return ready;
}

export async function clearHoldBlocker(
  sql: Sql,
  input: { suggestionId: string; blockerId: string; actorId: string },
  lookup: RecordLookup = fileLookup(),
): Promise<void> {
  const saved = await sql.query<{ id: string }>(
    `UPDATE proposal_blockers SET closed_at = now()
     WHERE id = $1 AND suggestion_id = $2 AND kind = 'hold' AND closed_at IS NULL
     RETURNING id`,
    [input.blockerId, input.suggestionId],
  );
  if (!saved.rows.length) throw new InputError("That hold is not open.", 404);
  const suggestion = await sql.query<{ target_kind: TargetKind; target_id: string }>(
    `SELECT target_kind, target_id FROM suggestions WHERE id = $1`,
    [input.suggestionId],
  );
  const row = suggestion.rows[0];
  await audit(sql, {
    actorId: input.actorId,
    action: "suggestion.blocker_clear",
    targetKind: row?.target_kind,
    targetId: row?.target_id,
    after: { id: input.suggestionId, blockerId: input.blockerId },
  });
  await refreshProposalReadiness(sql, lookup);
}
