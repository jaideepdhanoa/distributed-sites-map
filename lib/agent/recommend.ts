import { randomUUID } from "node:crypto";
import { seesRecommendations } from "@/lib/agent/access";
import { FeedError } from "@/lib/agent/inbox";
import type { Sql } from "@/lib/actions/db";
import { InputError } from "@/lib/actions/text";
import { assertClean } from "@/lib/policy/banned";

export type RecommendationKind = "reply" | "decision";
export type RecommendationDecision = "approve" | "reject" | "none";
export type Confidence = "high" | "medium" | "low";

export type RecommendationSource = { label: string; url?: string; ref?: string };

export type RecommendationDraft = {
  kind: RecommendationKind;
  draftText: string;
  decision: RecommendationDecision;
  rationale: string;
  sources: RecommendationSource[];
  confidence: Confidence;
  model: string;
};

export type VisibleRecommendation = {
  id: string;
  kind: RecommendationKind;
  draftText: string;
  decision: RecommendationDecision;
  rationale: string;
  sources: { label: string; url: string | null; ref: string | null }[];
  confidence: Confidence;
  threadKey: string;
  proposalId: string | null;
};

type SourceRow = { label?: string; url?: string; ref?: string };

function sourcesOf(value: unknown): VisibleRecommendation["sources"] {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      parsed = [];
    }
  }
  const rows = Array.isArray(parsed) ? parsed : [];
  return rows.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as SourceRow;
    const label = String(row.label || "").trim();
    if (!label) return [];
    return [{ label, url: row.url ? String(row.url) : null, ref: row.ref ? String(row.ref) : null }];
  });
}

export function parseRecommendation(body: unknown): RecommendationDraft {
  if (!body || typeof body !== "object") throw new FeedError("The recommendation could not be read.");
  const row = body as Record<string, unknown>;
  const kind = row.kind === "reply" || row.kind === "decision" ? row.kind : null;
  const decision = row.decision === "approve" || row.decision === "reject" || row.decision === "none" ? row.decision : null;
  const confidence = row.confidence === "high" || row.confidence === "medium" || row.confidence === "low" ? row.confidence : null;
  const draftText = String(row.draft_text || "").trim();
  const rationale = String(row.rationale || "").trim();
  const model = String(row.model || "").trim();
  const sources = Array.isArray(row.sources) ? row.sources : [];
  if (!kind || !decision || !confidence) throw new FeedError("The recommendation could not be read.");
  if (kind === "reply" && decision !== "none") throw new FeedError("A reply draft does not decide the proposal.");
  if (kind === "decision" && decision === "none") throw new FeedError("A decision draft names approve or reject.");
  if (!draftText || draftText.length > 2000) throw new FeedError("Write the draft in 2000 characters or fewer.");
  if (!rationale || rationale.length > 2000) throw new FeedError("Add the rationale.");
  if (!model || model.length > 80) throw new FeedError("Name the model.");
  if (!sources.length) throw new FeedError("Add at least one source.");
  const parsed: RecommendationSource[] = [];
  for (const item of sources) {
    if (!item || typeof item !== "object") throw new FeedError("Add at least one source.");
    const source = item as SourceRow;
    const label = String(source.label || "").trim();
    const url = String(source.url || "").trim();
    const ref = String(source.ref || "").trim();
    if (!label || label.length > 160) throw new FeedError("Name each source.");
    if (!url && !ref) throw new FeedError("Each source needs a url or a ref.");
    if (url && !/^https:\/\/|^\/\?/.test(url)) throw new FeedError("A source url stays on https or a map link.");
    assertClean(label);
    parsed.push({ label, url: url || undefined, ref: ref || undefined });
  }
  assertClean(draftText);
  assertClean(rationale);
  return { kind, draftText, decision, rationale, sources: parsed, confidence, model };
}

export async function addRecommendation(sql: Sql, inboxId: string, draft: RecommendationDraft): Promise<string> {
  const inbox = await sql.query<{ id: string; status: string; proposal_id: string | null }>(
    `SELECT id, status, proposal_id FROM agent_inbox WHERE id = $1`,
    [inboxId],
  );
  const row = inbox.rows[0];
  if (!row) throw new FeedError("That inbox row is not in the feed.", 404);
  if (row.status === "superseded") throw new FeedError("That inbox row was superseded.", 409);
  if (draft.kind === "decision" && !row.proposal_id) throw new FeedError("A decision needs an open proposal.", 409);
  if (row.proposal_id) {
    const proposal = await sql.query<{ status: string }>(`SELECT status FROM suggestions WHERE id = $1`, [row.proposal_id]);
    if (proposal.rows[0]?.status !== "open") throw new FeedError("That proposal is no longer open.", 409);
  }
  const id = randomUUID();
  await sql.query(
    `INSERT INTO agent_recommendations (
      id, inbox_id, kind, draft_text, decision, rationale, sources, confidence, model
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
    [id, inboxId, draft.kind, draft.draftText, draft.decision, draft.rationale, JSON.stringify(draft.sources), draft.confidence, draft.model],
  );
  return id;
}

export async function listVisibleRecommendations(sql: Sql, username: string, recordId: string): Promise<VisibleRecommendation[]> {
  if (!seesRecommendations(username)) return [];
  const rows = await sql.query<{
    id: string;
    kind: RecommendationKind;
    draft_text: string;
    decision: RecommendationDecision;
    rationale: string;
    sources: unknown;
    confidence: Confidence;
    thread_key: string;
    proposal_id: string | null;
  }>(
    `SELECT r.id, r.kind, r.draft_text, r.decision, r.rationale, r.sources, r.confidence, i.thread_key, i.proposal_id
     FROM agent_recommendations r
     JOIN agent_inbox i ON i.id = r.inbox_id
     WHERE r.dismissed_at IS NULL
       AND i.status <> 'superseded'
       AND (i.record_id = $1 OR i.site_id = $1)
       AND (
         i.proposal_id IS NULL
         OR EXISTS (SELECT 1 FROM suggestions s WHERE s.id = i.proposal_id AND s.status = 'open')
       )
     ORDER BY r.created_at DESC, r.id DESC`,
    [recordId],
  );
  return rows.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    draftText: row.draft_text,
    decision: row.decision,
    rationale: row.rationale,
    sources: sourcesOf(row.sources),
    confidence: row.confidence,
    threadKey: row.thread_key,
    proposalId: row.proposal_id,
  }));
}

export async function dismissRecommendation(sql: Sql, username: string, id: string): Promise<void> {
  if (!seesRecommendations(username)) throw new InputError("That suggestion is not available.", 404);
  const saved = await sql.query<{ id: string }>(
    `UPDATE agent_recommendations SET dismissed_at = now() WHERE id = $1 AND dismissed_at IS NULL RETURNING id`,
    [id],
  );
  if (!saved.rows.length) throw new InputError("That suggestion is not available.", 404);
}

export async function attachRecommendation(
  sql: Sql,
  input: { recommendationId?: string | null; actorId: string; kind: RecommendationKind },
): Promise<{ recommendationId: string | null; draftedByAgent: string | null }> {
  const id = String(input.recommendationId || "").trim();
  if (!id || !seesRecommendations(input.actorId)) return { recommendationId: null, draftedByAgent: null };
  const rows = await sql.query<{ id: string; model: string; kind: string }>(
    `SELECT id, model, kind FROM agent_recommendations WHERE id = $1`,
    [id],
  );
  const row = rows.rows[0];
  if (!row || row.kind !== input.kind) return { recommendationId: null, draftedByAgent: null };
  await sql.query(`UPDATE agent_recommendations SET used_at = now() WHERE id = $1`, [id]);
  return { recommendationId: row.id, draftedByAgent: row.model };
}
