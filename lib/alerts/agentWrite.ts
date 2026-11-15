import type { Sql } from "@/lib/actions/db";
import type { Actor } from "@/lib/changes/schema";
import { publicSnippet } from "./compose";
import { isExcludedSite } from "./excluded";
import { discussionHref, homeHref, proposalHref, siteHref } from "./links";
import { queueAgentAlert, reviewerRecipients } from "./notify";

const AGENTS = new Set(["indie", "muse"]);
export const JAIDEEP_ID = "jaideep";

export function isBearerAgent(actor: { id: string; kind?: string }): boolean {
  return actor.kind === "agent" && AGENTS.has(actor.id.trim().toLowerCase());
}

function agentActorId(model: string): string {
  const id = model.trim().toLowerCase();
  return AGENTS.has(id) ? id : "muse";
}

export function textAddressesJaideep(value: string): boolean {
  return /\bjaideep\b/i.test(value) || value.trim().toLowerCase() === "jaideep@dhanoa.in";
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

function joined(payload: Record<string, unknown>, keys: string[]): string {
  return keys.map((key) => String(payload[key] || "")).join(" ");
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
    const event = await sql.query<{ payload: unknown }>(`SELECT payload FROM events WHERE id = $1`, [result.event_id]);
    const payload = asObject(event.rows[0]?.payload);
    if (result.entity_type === "stage") {
      const stage = publicSnippet(String(payload.stage || "")) || "a new stage";
      await queueAgentAlert(sql, {
        actorId,
        userIds: reviewerRecipients(),
        category: "stages",
        siteId: result.site_id,
        summary: `Stage is now ${stage}.`,
        href: siteHref(result.site_id),
        refId: result.event_id,
      });
      continue;
    }
    if (result.entity_type !== "activity" && result.entity_type !== "comms") continue;
    const text = result.entity_type === "comms"
      ? joined(payload, ["person", "subject", "summary", "asks_made", "asks_answered"])
      : joined(payload, ["summary"]);
    if (!textAddressesJaideep(text)) continue;
    const snippet = publicSnippet(String(payload.summary || payload.subject || ""));
    await queueAgentAlert(sql, {
      actorId,
      userIds: [JAIDEEP_ID],
      category: "mentions",
      siteId: result.site_id,
      summary: snippet || (result.entity_type === "comms" ? "A comment addressed to you." : "A note addressed to you."),
      href: discussionHref(result.site_id),
      refId: result.event_id,
    });
  }
}

export async function notifyNewRecommendation(sql: Sql, id: string, model: string): Promise<void> {
  const rows = await sql.query<{
    site_id: string;
    kind: string;
    draft_text: string;
    proposal_id: string | null;
    inbox_kind: string;
  }>(
    `SELECT i.site_id, r.kind, r.draft_text, i.proposal_id, i.kind AS inbox_kind
     FROM agent_recommendations r
     JOIN agent_inbox i ON i.id = r.inbox_id
     WHERE r.id = $1`,
    [id],
  );
  const row = rows.rows[0];
  if (!row || isExcludedSite(row.site_id)) return;
  const decision = row.kind === "decision";
  const proposal = !decision && (Boolean(row.proposal_id) || row.inbox_kind === "suggestion");
  const category = decision ? "decisions" : proposal ? "proposals" : "recommendations";
  const snippet = publicSnippet(row.draft_text);
  const summary = snippet
    || (decision ? "A decision is waiting." : proposal ? "A proposal is waiting." : "A recommendation is waiting.");
  await queueAgentAlert(sql, {
    actorId: agentActorId(model),
    userIds: reviewerRecipients(),
    category,
    siteId: row.site_id,
    summary,
    href: decision || proposal ? proposalHref(row.site_id) : discussionHref(row.site_id),
    refId: id,
  });
}

export async function notifyAskGap(
  sql: Sql,
  input: { refId: string; actorId: string; siteId: string; question: string },
): Promise<void> {
  const siteId = input.siteId || "portfolio";
  if (isExcludedSite(siteId)) return;
  const snippet = publicSnippet(input.question);
  await queueAgentAlert(sql, {
    actorId: input.actorId,
    userIds: reviewerRecipients(),
    category: "decisions",
    siteId,
    summary: snippet || "An unanswered question was logged.",
    href: siteId === "portfolio" ? homeHref() : siteHref(siteId),
    refId: input.refId,
  });
}
