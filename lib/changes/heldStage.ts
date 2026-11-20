import type { Sql } from "@/lib/actions/db";
import { actionsEnabled, withSql } from "@/lib/actions/db";
import type { RecordLookup } from "@/lib/actions/records";
import { fileLookup } from "@/lib/actions/records";
import { isExcludedSite } from "@/lib/alerts/excluded";
import { safeSnapshot } from "@/lib/policy/banned";
import { approvedStage, stageKey } from "@/lib/stageOverlay";
import { getUsers } from "@/lib/users";
import { formatZonedTimestamp } from "./schema";
import { canonicalStageName } from "./stageLabel";
import { SITE_ID } from "./vocab";

/**
 * The latest accepted stage decision for a site.
 * It stays on the map after the suggestion is marked applied.
 * A workbook sync or a snapshot does not replace it. A newer decision does.
 */

const NON_HUMAN = new Set(["system", "workbook-sync", "workbook-mirror", "muse", "indie"]);

export type HeldStage = {
  siteId: string;
  proposalId: string;
  stage: string;
  group: string;
  reason: string;
  proposer: string;
  approver: string;
  /** Exact ISO-8601 time with a numeric zone offset. */
  at: string;
  rank: number;
};

type HeldRow = {
  id: string;
  target_kind: string;
  target_id: string;
  field_name: string;
  detail: string | null;
  proposed_value: string;
  reason: string;
  decision_note: string | null;
  author_id: string;
  decided_by: string | null;
  decided_at: Date | string | null;
};

const HELD_SQL = `
  SELECT id, target_kind, target_id, field_name, detail, proposed_value, reason,
         decision_note, author_id, decided_by, decided_at
  FROM suggestions
  WHERE status IN ('accepted', 'applied')
    AND (
      field_name = 'stage'
      OR (field_name = 'correction' AND detail IN ('stage', 'pipeline_stage'))
      OR (field_name = 'proposed_next_step' AND detail IN ('stage_move', 'knock_off', 'bring_back'))
    )
`;

export function humanDecider(id: string | null | undefined): boolean {
  const who = String(id || "").trim().toLowerCase();
  return Boolean(who) && !NON_HUMAN.has(who);
}

function accountName(id: string | null): string {
  if (!id) return "";
  const account = getUsers().find((user) => user.u === id);
  return account?.displayName || id;
}

function zoned(value: Date | string | null): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return formatZonedTimestamp(date);
}

function siteOf(row: HeldRow, lookup?: RecordLookup): string {
  const id = String(row.target_id || "").trim();
  if (SITE_ID.test(id.toUpperCase())) return id.toUpperCase();
  if (!lookup) return "";
  const record = lookup(row.target_kind === "site" ? "site" : "deal", id);
  const linked = String(record?.linked_deal_id || record?.deal_id || "").trim();
  return SITE_ID.test(linked.toUpperCase()) ? linked.toUpperCase() : "";
}

export async function loadHeldStages(sql: Sql, lookup?: RecordLookup): Promise<HeldStage[]> {
  const rows = await sql.query<HeldRow>(HELD_SQL);
  const best = new Map<string, HeldStage>();
  for (const row of rows.rows) {
    if (!humanDecider(row.decided_by)) continue;
    const siteId = siteOf(row, lookup);
    if (!siteId || isExcludedSite(siteId)) continue;
    const approved = approvedStage({ field: row.field_name, detail: row.detail, proposedValue: row.proposed_value });
    if (!approved) continue;
    const stage = canonicalStageName(approved.stage);
    if (!stage) continue;
    const at = zoned(row.decided_at);
    const rank = at ? Date.parse(at) || 0 : 0;
    const held: HeldStage = {
      siteId,
      proposalId: row.id,
      stage,
      group: approved.group,
      reason: safeSnapshot(row.decision_note || row.reason || "", 500),
      proposer: accountName(row.author_id),
      approver: accountName(row.decided_by),
      at,
      rank,
    };
    const current = best.get(siteId);
    if (!current || held.rank > current.rank || (held.rank === current.rank && held.proposalId > current.proposalId)) {
      best.set(siteId, held);
    }
  }
  return [...best.values()];
}

export async function decisionHeldSiteIds(sql: Sql): Promise<Set<string>> {
  let lookup: RecordLookup | undefined;
  try {
    lookup = await fileLookup();
  } catch {
    lookup = undefined;
  }
  const held = await loadHeldStages(sql, lookup);
  return new Set(held.map((row) => row.siteId));
}

type FeatureFile = { features?: { properties?: Record<string, unknown> }[] };

function paintDeal(properties: Record<string, unknown>, held: HeldStage): Record<string, unknown> {
  const next: Record<string, unknown> = { ...properties, stage: held.stage, stage_group: held.group };
  if (held.group !== "dropped") {
    delete next.decision_reason;
    delete next.decision_proposer;
    delete next.decision_approver;
    delete next.decision_at;
    return next;
  }
  delete next.suggested_drop;
  if (held.reason) next.decision_reason = held.reason;
  else delete next.decision_reason;
  if (held.proposer) next.decision_proposer = held.proposer;
  if (held.approver) next.decision_approver = held.approver;
  if (held.at) next.decision_at = held.at;
  return next;
}

/** Draw held decisions over a snapshot. The generated file is not edited. */
export function applyHeldStages<T extends FeatureFile>(file: T, held: HeldStage[], kind: "deal" | "site"): T {
  const features = file.features;
  if (!features?.length || !held.length) return file;
  const byId = new Map(held.map((row) => [row.siteId, row]));
  let changed = false;
  const nextFeatures = features.map((feature) => {
    const properties = feature.properties;
    if (!properties) return feature;
    const ids = kind === "deal"
      ? [String(properties.deal_id || "")]
      : [String(properties.linked_deal_id || ""), String(properties.site_id || "")];
    const row = ids.map((id) => byId.get(id.trim().toUpperCase())).find(Boolean);
    if (!row) return feature;
    if (kind === "deal" && stageKey(String(properties.stage || "")) === row.group && row.group !== "dropped") {
      const same = String(properties.stage || "") === row.stage && !properties.decision_reason;
      if (same) return feature;
    }
    changed = true;
    if (kind === "site") {
      return {
        ...feature,
        properties: { ...properties, pipeline_stage: row.stage, linked_deal_stage: row.stage },
      };
    }
    return { ...feature, properties: paintDeal(properties, row) };
  });
  if (!changed) return file;
  return { ...file, features: nextFeatures };
}

export async function overlayHeldStages<T extends FeatureFile>(file: T, kind: "deal" | "site" = "deal"): Promise<T> {
  if (!actionsEnabled()) return file;
  try {
    const lookup = await fileLookup();
    const held = await withSql((sql) => loadHeldStages(sql, lookup));
    return applyHeldStages(file, held, kind);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code || "") : "";
    if (code !== "42P01") console.error(JSON.stringify({ event: "held_stage_unavailable", code: code || "unknown" }));
    return file;
  }
}
