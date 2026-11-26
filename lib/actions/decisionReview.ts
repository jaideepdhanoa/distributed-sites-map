import { createHash } from "node:crypto";
import { comparableText, evidenceChanged, figureKey, type CitationReview, type ReviewEvidence } from "@/lib/comparisonDecision";
import { isExcludedSite } from "@/lib/alerts/excluded";
import { audit } from "./audit";
import type { Sql } from "./db";
import type { decisionCatalog } from "./decisionCatalog";
import { findRequests, parseEvidenceTarget } from "./evidenceLookup";
import { evidenceMeasures } from "./comparisonEvidence";
import { InputError, stamp } from "./text";
import { viewFor, type StoredFigure } from "./viewDecision";

type Catalog = Pick<ReturnType<typeof decisionCatalog>, "name" | "figure"> & Partial<Pick<ReturnType<typeof decisionCatalog>,"prepareStatements">>;
type Decision = {
  view: string; name: string; url_query: string; version: string; at: Date | string;
  draft: { preferred: string | null; citations: StoredFigure[] };
};
type Review = { view: string; id: string; key: string; version: string; actor_id: string; at: Date | string; evidence: ReviewEvidence };

export async function decisionReviews(sql: Sql, actor: string, catalog: () => Promise<Catalog>, view = ""): Promise<CitationReview[]> {
  const decisions = await sql.query<Decision>(
    `SELECT v.id AS view, v.name, v.url_query, d.id::text AS version, d.at, d.after_json AS draft
     FROM saved_views v CROSS JOIN LATERAL (
       SELECT id,at,after_json FROM audit_log WHERE target_kind='view' AND target_id=v.id AND action='view.decision'
       ORDER BY id DESC LIMIT 1
     ) d WHERE (v.owner_id=$1 OR v.scope='team') AND ($2='' OR v.id=$2) ORDER BY d.at DESC,v.id`, [actor, view]);
  const citations = decisions.rows.flatMap(decision => {
    const ids = new URLSearchParams(decision.url_query).get("compare")?.split("|") || [];
    if (ids.some(isExcludedSite)) return [];
    return decision.draft.citations.filter(c => ids.includes(c.targetId)).map(c => ({ decision, c }));
  });
  if (!citations.length) return [];
  const records = await catalog();
  await records.prepareStatements?.(sql,citations.map(({c}) => c));
  const reviews = await sql.query<Review>(
    `SELECT DISTINCT ON (target_id,after_json->>'version',after_json->>'key')
       target_id AS view,id::text,after_json->>'key' AS key,after_json->>'version' AS version,actor_id,at,after_json->'evidence' AS evidence
     FROM audit_log WHERE action='view.decision.review' AND target_kind='view' AND target_id=ANY($1::text[])
       AND (after_json->>'version')=ANY($2::text[])
     ORDER BY target_id,after_json->>'version',after_json->>'key',audit_log.id DESC`,
    [decisions.rows.map(d=>d.view), decisions.rows.map(d=>d.version)]);
  const byVersion = new Map(reviews.rows.map(r => [r.version + "|" + r.key, r]));
  const requests = await findRequests(sql, citations.map(({ decision, c }) => ({
    target: parseEvidenceTarget(new URLSearchParams({ targetId:c.targetId,targetKind:c.targetKind,measure:c.measure,period:c.period,basis:c.basis })),
    note: c.note, since: decision.at,
  })));
  return citations.flatMap(({ decision: d, c }, index) => {
    const live = records.figure(c);
    if (!live) return [];
    const key = figureKey(c);
    const last = byVersion.get(d.version + "|" + key);
    const closed = requests[index]?.closedAt || "";
    // Old decisions predate the stored completion baseline. An already-finished task stays quiet.
    const originalClosed = c.closed ?? (closed && Date.parse(closed) <= new Date(d.at).getTime() ? closed : "");
    const previous = last?.evidence || { value:c.value, period:c.period, basis:c.basis, closed:originalClosed };
    const current = { value:live.value, period:live.period, basis:live.basis, closed };
    const changed = evidenceChanged(previous, current);
    const completed = Boolean(closed && previous.closed !== closed);
    const reasons = [];
    if (changed) reasons.push(comparableText(previous.value) === "not on file" && !["not on file","not applicable","unavailable"].includes(comparableText(current.value)) ? "New evidence" : "Figure changed");
    if (completed) reasons.push("Follow-up completed");
    const identity = [d.version, key, last?.id || "", comparableText(live.value), comparableText(live.period), comparableText(live.basis), closed];
    const query = new URLSearchParams(d.url_query);
    query.set("savedView", d.view);
    query.set("reviewCitation", key);
    return [{ key, version:d.version, view:d.view, name:d.name, site:c.targetId, siteName:records.name(c.targetId), measure:evidenceMeasures[c.measure],
      href:"/?" + query, outcome:d.draft.preferred ? "Prefer " + records.name(d.draft.preferred) : "Hold all sites",
      original:c.value, previous, current, source:live.source, reason:reasons.join(" · "),
      token:createHash("sha256").update(JSON.stringify(identity)).digest("hex"), reviewedBy:last?.actor_id || "",
      reviewedAt:last ? stamp(last.at).replace(/Z$/, "+00:00") : "",
    }];
  });
}

export async function verifyDecisionReview(sql: Sql, actor: string, view: string, key: string, token: string, catalog: () => Promise<Catalog>) {
  const record = await viewFor(sql, view, actor, true);
  if (record.owner !== actor) throw new InputError("Only the comparison owner can review this change.", 403);
  const item = (await decisionReviews(sql, actor, catalog, view)).find(r => r.key === key);
  if (!item?.reason || item.token !== token) throw new InputError("The evidence or decision changed. Refresh and review the latest figures.", 409);
  return item;
}

export async function keepDecision(sql: Sql, actor: string, item: CitationReview, version: string) {
  const head = await sql.query<{ id: string }>(
    "SELECT id::text FROM audit_log WHERE action='view.decision' AND target_kind='view' AND target_id=$1 ORDER BY audit_log.id DESC LIMIT 1", [item.view]);
  if (head.rows[0]?.id !== version) throw new InputError("The decision changed. Refresh before reviewing.", 409);
  await audit(sql, { actorId:actor, action:"view.decision.review", targetKind:"view", targetId:item.view,
    after:{ version, key:item.key, evidence:item.current, reason:item.reason, source:"My work" } });
}
