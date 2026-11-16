import type { Sql } from "@/lib/actions/db";
import type { Actor } from "@/lib/changes/schema";
import { isExcludedSite } from "./excluded";
import { discussionHref, homeHref, proposalHref, reviewHref } from "./links";
import { queueAgentAlert, reviewerRecipients } from "./notify";
import { isWorkbookWrite } from "./summary";

const AGENTS = new Set(["indie", "muse"]);
export const JAIDEEP_ID = "jaideep";

export function isBearerAgent(actor: { id: string; kind?: string }): boolean {
  return actor.kind === "agent" && AGENTS.has(actor.id.trim().toLowerCase());
}

function agentActorId(model: string): string {
  const id = model.trim().toLowerCase();
  return AGENTS.has(id) ? id : "muse";
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

/** A stage row is mailed only when a previous row exists and the stage value changed. */
export function stageWriteKind(payload: Record<string, unknown>): "skip" | "changed" {
  const next = String(payload.stage || "");
  if (!("previous_stage" in payload)) return "changed";
  const previous = payload.previous_stage;
  if (previous == null || String(previous).trim() === "") return "skip";
  if (String(previous) === next) return "skip";
  return "changed";
}

async function tiedToApprovedDecision(sql: Sql, siteId: string, stage: string): Promise<boolean> {
  const rows = await sql.query<{ id: string }>(
    `SELECT id FROM suggestions
     WHERE target_id = $1
       AND status = 'accepted'
       AND (
         proposed_value = $2
         OR (detail = 'knock_off' AND $2 = 'Dropped')
       )
     LIMIT 1`,
    [siteId, stage],
  );
  return rows.rows.length > 0;
}

export async function notifyAppliedChanges(
  sql: Sql,
  actor: Actor,
  results: { entity_type: string; site_id: string; event_id: string }[],
): Promise<void> {
  if (!isBearerAgent(actor)) return;
  const actorId = actor.id.trim().toLowerCase();
  for (const result of results) {
    if (!result.site_id || isExcludedSite(result.site_id)) continue;
    if (result.entity_type === "activity" || result.entity_type === "comms" || result.entity_type === "site") continue;
    if (result.entity_type !== "stage") continue;
    const event = await sql.query<{ payload: unknown; source: string; actor: string }>(
      `SELECT payload, source, actor FROM events WHERE id = $1`,
      [result.event_id],
    );
    const row = event.rows[0];
    if (!row || isWorkbookWrite(row.source, row.actor)) continue;
    const payload = asObject(row.payload);
    if (stageWriteKind(payload) === "skip") continue;
    const stage = String(payload.stage || "");
    const approved = await tiedToApprovedDecision(sql, result.site_id, stage);
    if (!approved) {
      await queueAgentAlert(sql, {
        actorId,
        userIds: reviewerRecipients(),
        category: "stages",
        siteId: result.site_id,
        summary: "An agent changed the stage without an approved decision.",
        href: reviewHref(result.site_id),
        refId: result.event_id,
        channel: "instant",
        force: true,
      });
      continue;
    }
    await queueAgentAlert(sql, {
      actorId,
      userIds: reviewerRecipients(),
      category: "stages",
      siteId: result.site_id,
      summary: "A stage change from an approved decision.",
      href: reviewHref(result.site_id),
      refId: result.event_id,
    });
  }
}

export async function notifyNewRecommendation(sql: Sql, id: string, model: string): Promise<void> {
  const rows = await sql.query<{ site_id: string; kind: string }>(
    `SELECT i.site_id, r.kind
     FROM agent_recommendations r
     JOIN agent_inbox i ON i.id = r.inbox_id
     WHERE r.id = $1`,
    [id],
  );
  const row = rows.rows[0];
  if (!row || isExcludedSite(row.site_id)) return;
  const decision = row.kind === "decision";
  await queueAgentAlert(sql, {
    actorId: agentActorId(model),
    userIds: reviewerRecipients(),
    category: decision ? "decisions" : "recommendations",
    siteId: row.site_id,
    summary: decision ? "A decision request is waiting." : "An agent draft reply is waiting.",
    href: decision ? proposalHref(row.site_id) : discussionHref(row.site_id),
    refId: id,
  });
}

/** Ask gaps stay in the morning digest. They are not instant mail, and the question text is not copied into the outbox. */
export async function notifyAskGap(
  sql: Sql,
  input: { refId: string; actorId: string; siteId: string; question: string },
): Promise<void> {
  const siteId = input.siteId || "portfolio";
  if (isExcludedSite(siteId)) return;
  await queueAgentAlert(sql, {
    actorId: input.actorId,
    userIds: reviewerRecipients(),
    category: "asks",
    siteId,
    summary: "An open question was logged.",
    href: siteId === "portfolio" ? homeHref() : discussionHref(siteId),
    refId: input.refId,
  });
}
