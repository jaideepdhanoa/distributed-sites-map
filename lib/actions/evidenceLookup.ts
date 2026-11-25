import { isExcludedSite } from "@/lib/alerts/excluded";
import { evidenceMeasures, type EvidenceMeasure, type EvidenceRequest } from "./comparisonEvidence";
import type { Sql } from "./db";
import { stamp } from "./text";
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

export type RequestLookup = {
  target: ReturnType<typeof parseEvidenceTarget>; note?: string; since?: Date | string | null;
};

/** Resolve all cited requests in one read, keeping the original thread even after completion. */
export async function findRequests(sql: Sql, lookups: RequestLookup[]): Promise<(EvidenceRequest | null)[]> {
  if (!lookups.length) return [];
  const inputs = lookups.map(({ target, note, since }, i) => ({
    i, kind: target.targetKind, site: target.targetId, source: target.source, note: note || "", since,
  }));
  const { rows } = await sql.query<{ id: string | null; status: string; owner: string; due: string; closed_at: string | Date | null }>(
    `SELECT n.id, CASE WHEN n.resolved_at IS NOT NULL THEN 'resolved' WHEN s.done_at IS NOT NULL THEN 'completed'
       ELSE coalesce(s.status,'Unresolved') END AS status, coalesce(s.owner_id,'') AS owner,
       coalesce(s.target_on::text,'') AS due, least(n.resolved_at,s.done_at) AS closed_at
     FROM jsonb_to_recordset($1::jsonb) AS q(i int,kind text,site text,source text,note text,since timestamptz)
     LEFT JOIN LATERAL (
       SELECT id,resolved_at FROM notes WHERE target_kind=q.kind AND target_id=q.site AND parent_id IS NULL
         AND ((q.note='' AND (resolved_at IS NULL OR created_at >= q.since)) OR id=q.note)
         AND deleted_at IS NULL AND body LIKE 'Missing evidence\n%' AND right(body,length(q.source))=q.source
         ORDER BY created_at,id LIMIT 1
     ) n ON true
     LEFT JOIN LATERAL (
       SELECT status,owner_id,target_on,done_at FROM suggestions WHERE n.id IS NOT NULL AND target_kind=q.kind AND target_id=q.site
         AND reason=('Evidence gap: /?site=' || q.site || '&panel=discussion&note=' || n.id) AND field_name='proposed_next_step'
         ORDER BY (done_at IS NULL AND status IN ('open','ready','accepted','agreed_waiting')) DESC, created_at DESC LIMIT 1
     ) s ON true ORDER BY q.i`, [JSON.stringify(inputs)]);
  return rows.map(row => row.id ? {
    note: row.id, status: row.status, owner: row.owner, due: row.due,
    ...(row.closed_at ? { closedAt: stamp(row.closed_at).replace(/Z$/, "+00:00") } : {}),
  } : null);
}

export async function findRequest(sql: Sql, target: RequestLookup["target"], linkedNote = "", since: Date | string | null = null) {
  return (await findRequests(sql, [{ target, note: linkedNote, since }]))[0];
}
