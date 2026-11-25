import { isExcludedSite } from "@/lib/alerts/excluded";
import { evidenceMeasures, type EvidenceMeasure, type EvidenceRequest } from "./comparisonEvidence";
import type { Sql } from "./db";
import { gapReference } from "./gapReference";
import { InputError, parseTarget } from "./text";

export function parseEvidenceTarget(query: URLSearchParams) {
  const target = parseTarget(query.get("targetKind"), query.get("targetId"));
  const measure = query.get("measure") || "";
  if (isExcludedSite(target.targetId) || !Object.hasOwn(evidenceMeasures, measure)) throw new InputError("Choose an available measure.");
  const period = (query.get("period") || "").trim();
  const basis = (query.get("basis") || "").trim();
  if ([period, basis].some(value => value.length > 160 || /[\r\n]/.test(value))) throw new InputError("Invalid reporting period or basis.");
  const label = evidenceMeasures[measure as EvidenceMeasure];
  const context = [label, period, basis].filter(Boolean).join(" · ");
  const key = new URLSearchParams({ measure, period: period.toLowerCase(), basis: basis.toLowerCase() });
  return { ...target, context, source: "\nSource: Compare?" + key };
}

export async function findRequest(sql: Sql, target: ReturnType<typeof parseEvidenceTarget>, linkedNote = "", since: Date | string | null = null): Promise<EvidenceRequest | null> {
  const result = await sql.query<{ id: string; resolved_at: unknown }>(
    `SELECT id,resolved_at FROM notes WHERE target_kind=$1 AND target_id=$2 AND parent_id IS NULL
       AND (($4 = '' AND (resolved_at IS NULL OR created_at >= $5::timestamptz)) OR id = $4) AND deleted_at IS NULL AND body LIKE 'Missing evidence\n%'
       AND right(body,length($3::text))=$3 ORDER BY created_at,id LIMIT 1`,
    [target.targetKind, target.targetId, target.source, linkedNote, since]);
  const note = result.rows[0]?.id;
  if (!note) return null;
  const steps = await sql.query<{ status: string; owner: string; due: string }>(
    `SELECT CASE WHEN done_at IS NOT NULL THEN 'completed' ELSE status END AS status,
      coalesce(owner_id,'') AS owner, coalesce(target_on::text,'') AS due
      FROM suggestions WHERE target_kind=$1 AND target_id=$2 AND reason=$3 AND field_name='proposed_next_step'
      ORDER BY (done_at IS NULL AND status IN ('open','ready','accepted','agreed_waiting')) DESC, created_at DESC LIMIT 1`,
    [target.targetKind, target.targetId, gapReference(target.targetId,note)]);
  return { note, ...(steps.rows[0] || { status: "Unresolved", owner: "", due: "" }), ...(result.rows[0].resolved_at ? { status: "resolved" } : {}) };
}
