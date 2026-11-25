import { isExcludedSite } from "@/lib/alerts/excluded";
import { evidenceMeasures, type EvidenceMeasure, type EvidenceRequest } from "@/lib/actions/comparisonEvidence";
import { createWithReceipt } from "@/lib/actions/createReceipt";
import type { Sql } from "@/lib/actions/db";
import { gapReference } from "@/lib/actions/gapReference";
import { isResponse, jsonError, jsonOk, openActions, runWrite } from "@/lib/actions/http";
import { createNote } from "@/lib/actions/notes";
import { createSuggestion } from "@/lib/actions/suggestions";
import { InputError, parseTarget } from "@/lib/actions/text";
import { getUsers } from "@/lib/users";

function parse(query: URLSearchParams) {
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

async function findRequest(sql: Sql, target: ReturnType<typeof parse>): Promise<EvidenceRequest | null> {
  const result = await sql.query<{ id: string }>(
    `SELECT id FROM notes WHERE target_kind=$1 AND target_id=$2 AND parent_id IS NULL
       AND resolved_at IS NULL AND deleted_at IS NULL AND body LIKE 'Missing evidence\n%'
       AND right(body,length($3::text))=$3 ORDER BY created_at,id LIMIT 1`,
    [target.targetKind, target.targetId, target.source]);
  const note = result.rows[0]?.id;
  if (!note) return null;
  const steps = await sql.query<{ status: string; owner: string; due: string }>(
    `SELECT CASE WHEN done_at IS NOT NULL THEN 'completed' ELSE status END AS status,
      coalesce(owner_id,'') AS owner, coalesce(target_on::text,'') AS due
      FROM suggestions WHERE target_kind=$1 AND target_id=$2 AND reason=$3 AND field_name='proposed_next_step'
      ORDER BY (done_at IS NULL AND status IN ('open','ready','accepted','agreed_waiting')) DESC, created_at DESC LIMIT 1`,
    [target.targetKind, target.targetId, gapReference(target.targetId,note)]);
  return { note, ...(steps.rows[0] || { status: "Unresolved", owner: "", due: "" }) };
}

export async function GET(request: Request) {
  const session = await openActions("viewer");
  if (isResponse(session)) return session;
  const data = await runWrite(session, { action: "comparison.evidence.read" }, async sql => ({
    followUp: await findRequest(sql, parse(new URL(request.url).searchParams)),
    accounts: session.actionRole === "viewer" ? [] : getUsers().map(user => ({ id: user.u, name: user.displayName || user.u })),
  }));
  return isResponse(data) ? data : jsonOk(data);
}

export async function POST(request: Request) {
  const session = await openActions("contributor");
  if (isResponse(session)) return session;
  if (!request.headers.get("Idempotency-Key")) return jsonError("Missing save reference.", 400);
  const body = await request.json().catch(() => null);
  if (!body || typeof body.description !== "string" || !body.description.trim() || body.description.length > 500) return jsonError("Describe the evidence in 1–500 characters.", 400);
  const result = await runWrite(session, { action: "comparison.evidence.request" }, async sql => {
    const target = parse(new URL(request.url).searchParams);
    return createWithReceipt(sql, request, session.u, { target, body }, async tx => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [JSON.stringify([target.targetKind,target.targetId,target.source])]);
      const existing = await findRequest(tx,target);
      if (existing) return existing;
      const title = ("Verify " + target.context).slice(0,120);
      const note = await createNote(tx, { targetKind:target.targetKind, targetId:target.targetId, authorId:session.u,
        body: "Missing evidence\n" + body.description.trim() + "\nCheck: " + target.context + target.source,
        openOnly: true });
      await createSuggestion(tx, { targetKind:target.targetKind, targetId:target.targetId, authorId:session.u,
        field:"proposed_next_step", detail:"work_item", title, proposedValue:title, reason:gapReference(target.targetId,note.id),
        ownerId:body.owner, targetOn:body.due });
      return await findRequest(tx,target);
    });
  });
  return isResponse(result) ? result : jsonOk({ followUp:result });
}
