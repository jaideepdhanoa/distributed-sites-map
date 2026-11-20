import type { Sql } from "@/lib/actions/db";
import { InputError } from "@/lib/actions/text";
import { isExcludedSite } from "@/lib/alerts/excluded";
import { approvedStage } from "@/lib/stageOverlay";
import { advanceReasonCode, dropReasonCode } from "@/lib/tags/map";
import { applyBatch, VersionConflictError, type ApplyOptions, type ApplyResult } from "./apply";
import { formatZonedTimestamp, type Actor } from "./schema";
import { canonicalStageName, marketCode, serviceAreaCode } from "./stageLabel";
import { SITE_ID, type Market, type ServiceAreaClass } from "./vocab";

export const STAGE_DECISION_SOURCE = "Accepted stage decision";

export function isStageDecision(field: string, detail: string | null | undefined): boolean {
  if (field === "proposed_next_step") return detail === "stage_move" || detail === "bring_back" || detail === "knock_off";
  if (field === "stage") return true;
  if (field === "correction") return detail === "stage" || detail === "pipeline_stage";
  return false;
}

/**
 * A signed-in human accepted a stage decision. Write site_stages as that person.
 * Suggested drops stay suggestions until this accept. R-097.
 */
export async function writeAcceptedStage(
  sql: Sql,
  input: {
    id: string;
    field: string;
    detail: string | null;
    proposedValue: string;
    reason: string;
    note?: string;
    siteId: string;
    actorId: string;
  },
  options?: ApplyOptions & { idempotencyKey?: string },
): Promise<ApplyResult | null> {
  if (!isStageDecision(input.field, input.detail)) return null;
  if (isExcludedSite(input.siteId) || !SITE_ID.test(input.siteId)) return null;
  const approved = approvedStage({ field: input.field, detail: input.detail, proposedValue: input.proposedValue });
  const stage = approved ? canonicalStageName(approved.stage) : null;
  if (!stage) throw new InputError("That stage is not a known stage.");
  if (stage === "Dropped" && input.detail !== "knock_off" && input.field !== "stage" && input.field !== "correction") {
    return null;
  }
  const current = await sql.query<{ version: number | string; market: string; service_area_class: string }>(
    `SELECT version, market, service_area_class FROM site_stages WHERE site_id = $1`,
    [input.siteId],
  );
  const site = current.rows[0]
    ? null
    : await sql.query<{ market: string; service_area_class: string }>(
        `SELECT market, service_area_class FROM sites WHERE site_id = $1`,
        [input.siteId],
      );
  const storedMarket = current.rows[0]?.market || site?.rows[0]?.market || "";
  const market = marketCode(storedMarket, input.siteId);
  if (!market) throw new InputError("That site has no market.");
  const area = serviceAreaCode(current.rows[0]?.service_area_class || site?.rows[0]?.service_area_class || "");
  const reason = input.reason.trim().slice(0, 500);
  const actor: Actor = { id: input.actorId, kind: "human", role: "reviewer" };
  const payload: {
    stage: typeof stage;
    market: Market;
    service_area_class?: ServiceAreaClass;
    reason?: string;
    at: string;
  } = {
    stage,
    market,
    at: formatZonedTimestamp(),
  };
  if (area) payload.service_area_class = area;
  if (reason && (stage === "Dropped" || input.detail === "bring_back")) payload.reason = reason;
  try {
    const stageKey = options?.idempotencyKey || `stage-decision-${input.id}`;
    const applied = await applyBatch(
      sql,
      actor,
      stageKey,
      {
        changes: [
          {
            entity_type: "stage",
            site_id: input.siteId,
            expected_version: current.rows[0] ? Number(current.rows[0].version) : 0,
            source: STAGE_DECISION_SOURCE,
            payload,
          },
        ],
      },
      options,
    );
    const family = stage === "Dropped" ? "drop_reason" : input.detail === "stage_move" ? "advance_reason" : "";
    const code = family === "drop_reason" ? dropReasonCode(reason) : family === "advance_reason" ? advanceReasonCode(reason) : "";
    if (family && code && !applied.replayed) {
      const note = (input.note || "").trim();
      await sql.exec("SAVEPOINT tag_decision");
      try {
        const open = await sql.query<{ version: number | string }>(
          `SELECT version FROM site_tags WHERE site_id = $1 AND family = $2`,
          [input.siteId, family],
        );
        await applyBatch(
          sql,
          actor,
          `${stageKey}-${family}`,
          {
            changes: [
              {
                entity_type: "tag",
                site_id: input.siteId,
                expected_version: open.rows[0] ? Number(open.rows[0].version) : 0,
                source: STAGE_DECISION_SOURCE,
                payload: {
                  family,
                  code,
                  source_ref: "stage_decision",
                  ...(note ? { note } : {}),
                },
              },
            ],
          },
          options,
        );
        await sql.exec("RELEASE SAVEPOINT tag_decision");
      } catch (error) {
        await sql.exec("ROLLBACK TO SAVEPOINT tag_decision");
        const missing = Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "42P01");
        if (!missing) throw error;
      }
    }
    return applied;
  } catch (error) {
    if (error instanceof VersionConflictError) {
      throw new InputError("The stage changed. Reload this site and try the decision again.", 409);
    }
    throw error;
  }
}
