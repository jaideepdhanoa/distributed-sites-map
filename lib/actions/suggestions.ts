import { randomUUID } from "node:crypto";
import { assertClean, safeSnapshot } from "@/lib/policy/banned";
import { audit } from "./audit";
import type { Sql } from "./db";
import { fileLookup, recordField, valuesMatch, type RecordLookup } from "./records";
import {
  csvCell,
  InputError,
  parseBody,
  parseDetail,
  parseField,
  parseTarget,
  stamp,
  type SuggestionField,
  type TargetKind,
} from "./text";

export type SuggestionStatus = "open" | "accepted" | "rejected" | "applied";

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
};

const SELECT = `id, target_kind, target_id, field_name, detail, current_value, proposed_value, reason, status, author_id, created_at, decided_by, decided_at, applied_at`;

function present(row: SuggestionRow): Suggestion | null {
  const proposedValue = safeSnapshot(row.proposed_value, 500);
  const reason = safeSnapshot(row.reason, 2000);
  if (!proposedValue || !reason) return null;
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
  };
}

export async function listSuggestions(
  sql: Sql,
  filter?: { targetKind?: TargetKind; targetId?: string; status?: SuggestionStatus },
): Promise<Suggestion[]> {
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
  return rows.rows.map(present).filter((row): row is Suggestion => Boolean(row));
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
  },
  lookup: RecordLookup = fileLookup(),
): Promise<Suggestion> {
  const target = parseTarget(input.targetKind, input.targetId);
  const record = lookup(target.targetKind, target.targetId);
  if (!record) throw new InputError("That site or deal is not on the map.", 404);
  const field = parseField(input.field);
  const detail = parseDetail(field, input.detail);
  const proposedValue = parseBody(input.proposedValue, "proposed value", 500);
  const reason = parseBody(input.reason, "reason", 2000);
  assertClean(proposedValue);
  assertClean(reason);
  const id = randomUUID();
  const currentValue = safeSnapshot(recordField(record, field, detail));
  await sql.query(
    `INSERT INTO suggestions (
      id, target_kind, target_id, field_name, detail, current_value, proposed_value, reason, status, author_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open', $9)`,
    [id, target.targetKind, target.targetId, field, detail, currentValue, proposedValue, reason, input.authorId],
  );
  await audit(sql, {
    actorId: input.authorId,
    action: "suggestion.create",
    targetKind: target.targetKind,
    targetId: target.targetId,
    after: { id, field, detail, currentValue, proposedValue, reason, status: "open" },
  });
  const saved = await sql.query<SuggestionRow>(`SELECT ${SELECT} FROM suggestions WHERE id = $1`, [id]);
  const suggestion = present(saved.rows[0]);
  if (!suggestion) throw new InputError("That suggestion could not be saved.");
  return suggestion;
}

export async function decideSuggestion(
  sql: Sql,
  input: { id: string; status: "accepted" | "rejected"; actorId: string; note?: string },
): Promise<Suggestion> {
  if (input.status !== "accepted" && input.status !== "rejected") {
    throw new InputError("A reviewer can accept or reject an open suggestion.");
  }
  const note = input.note?.trim() ? parseBody(input.note, "note", 2000) : "";
  if (note) assertClean(note);
  const existing = await sql.query<SuggestionRow>(`SELECT ${SELECT} FROM suggestions WHERE id = $1`, [input.id]);
  const row = existing.rows[0];
  if (!row) throw new InputError("That suggestion is not in the queue.", 404);
  if (row.status !== "open") throw new InputError("Only an open suggestion can be accepted or rejected.");
  await sql.query(
    `UPDATE suggestions
     SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4
     WHERE id = $1 AND status = 'open'`,
    [input.id, input.status, input.actorId, note || null],
  );
  await audit(sql, {
    actorId: input.actorId,
    action: input.status === "accepted" ? "suggestion.accept" : "suggestion.reject",
    targetKind: row.target_kind,
    targetId: row.target_id,
    before: { id: row.id, status: "open" },
    after: { id: row.id, status: input.status, note },
  });
  const saved = await sql.query<SuggestionRow>(`SELECT ${SELECT} FROM suggestions WHERE id = $1`, [input.id]);
  const suggestion = present(saved.rows[0]);
  if (!suggestion) throw new InputError("That suggestion could not be updated.");
  return suggestion;
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
