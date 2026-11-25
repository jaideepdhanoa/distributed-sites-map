import { isExcludedSite } from "@/lib/alerts/excluded";
import { assertClean } from "@/lib/policy/banned";
import type { CitedFigure, DecisionAccess, DecisionDraft } from "@/lib/comparisonDecision";
import { figureKey } from "@/lib/comparisonDecision";
import { audit } from "./audit";
import type { Sql } from "./db";
import { findRequest, parseEvidenceTarget } from "./evidenceLookup";
import { InputError, parseBody, stamp } from "./text";

export type StoredFigure = CitedFigure & { note: string; closed?: string };
type Entry = { id: string; actor_id: string; at: Date | string;
  after_json: Omit<DecisionDraft, "citations"> & { citations: StoredFigure[] } };

export async function viewFor(sql: Sql, id: string, actor: string, lock = false) {
  const result = await sql.query<{ owner_id: string; url_query: string }>(
    "SELECT owner_id,url_query FROM saved_views WHERE id=$1 AND (owner_id=$2 OR scope='team')" + (lock ? " FOR UPDATE" : ""), [id, actor]);
  if (!result.rows[0]) throw new InputError("Comparison unavailable.", 404);
  const ids = new URLSearchParams(result.rows[0].url_query).get("compare")?.split("|") || [];
  if (ids.length < 2 || ids.length > 4 || ids.some(id => !id || isExcludedSite(id)) || new Set(ids).size !== ids.length) throw new InputError("Choose a saved comparison.");
  return { owner: result.rows[0].owner_id, ids };
}

// A decision is a dated event on a saved view. Later evidence never rewrites what the reviewer saw.
async function latest(sql: Sql, id: string) {
  const result = await sql.query<Entry>(
    "SELECT id::text,actor_id,at,after_json FROM audit_log WHERE target_kind='view' AND target_id=$1 AND action='view.decision' ORDER BY audit_log.id DESC LIMIT 1", [id]);
  return result.rows[0];
}

export async function readDecision(sql: Sql, id: string, actor: string, canWrite: boolean): Promise<DecisionAccess> {
  const view = await viewFor(sql, id, actor);
  const editable = canWrite && view.owner === actor;
  const row = await latest(sql, id);
  if (!row) return { editable, decision: null };
  const { citations, ...choice } = row.after_json;
  const current = await Promise.all(citations.map(async ({ note, closed, ...figure }) => {
    const target = parseEvidenceTarget(new URLSearchParams(figure));
    return { ...figure, followUp: await findRequest(sql, target, note, row.at) };
  }));
  return { editable, decision: { ...choice, citations: current, version: row.id, author: row.actor_id, at: stamp(row.at).replace(/Z$/, "+00:00") } };
}

export async function saveDecision(sql: Sql, id: string, actor: string, input: DecisionDraft, version: string) {
  const view = await viewFor(sql, id, actor, true);
  if (view.owner !== actor) throw new InputError("Only the comparison owner can record its decision.", 403);
  if (((await latest(sql, id))?.id || "") !== version) throw new InputError("A newer decision was saved. Reopen it before recording a revision.", 409);
  if (!input || (input.preferred !== null && !view.ids.includes(input.preferred))) throw new InputError("Choose a compared site or hold all sites.");
  const rationale = parseBody(input.rationale, "reason", 600);
  assertClean(rationale);
  if (!Array.isArray(input.citations) || !input.citations.length || input.citations.length > 6) throw new InputError("Cite one to six figures.");
  const citations: StoredFigure[] = [];
  for (const figure of input.citations) {
    if (!figure || typeof figure.value !== "string" || typeof figure.period !== "string" || typeof figure.basis !== "string" || !view.ids.includes(figure.targetId)) throw new InputError("Citations must belong to the saved comparison.");
    const target = parseEvidenceTarget(new URLSearchParams(figure));
    const value = parseBody(figure.value, "cited figure", 1200);
    if (["Unavailable", "Checking…", "Not applicable"].includes(value)) throw new InputError("Choose an applicable figure.");
    assertClean([value, figure.period, figure.basis].join(" "));
    if (citations.some(other => figureKey(other) === figureKey(figure))) throw new InputError("Choose each figure once.");
    const followUp = await findRequest(sql, target);
    citations.push({ targetId: target.targetId, targetKind: target.targetKind, measure: figure.measure,
      period: figure.period.trim(), basis: figure.basis.trim(), value, note: followUp?.note || "", closed: followUp?.closedAt || "" });
  }
  await audit(sql, { actorId: actor, action: "view.decision", targetKind: "view", targetId: id, after: { preferred: input.preferred, rationale, citations } });
  return readDecision(sql, id, actor, true);
}
