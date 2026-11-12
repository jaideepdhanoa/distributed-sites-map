import { stageTitle } from "@/lib/labels";

/**
 * Accepted stage decisions drawn on top of the generated workbook stage.
 *
 * The workbook stays the source of truth on disk. This module only changes
 * the copy served to the map.
 *
 * Workbook-newer rule:
 * - Overlay while the workbook still shows the stage recorded on the decision
 *   (`stage_at`, or `current_value` when that value is a stage).
 * - If the workbook stage is already the approved stage, the overlay is a no-op.
 *   Reconcile then marks the decision applied.
 * - If the workbook stage is a third value — neither that baseline nor the
 *   approved stage — a later sync moved the row, and the workbook wins.
 * - With no baseline, an accepted decision overlays until the workbook shows
 *   the approved stage.
 * - Only the latest accepted decision for a site is considered. Pending,
 *   waiting, ready, rejected, overtaken, and applied decisions are not drawn.
 */

export type StageKind = "deal" | "site";

export type StageLink = { dealId: string; siteId: string };

export type StageDecision = {
  id: string;
  targetKind: StageKind;
  targetId: string;
  field: string;
  detail: string | null;
  currentValue: string;
  proposedValue: string;
  reason: string;
  status: string;
  actorName: string;
  decidedAt: string | null;
  createdAt: string;
  stageAt: string | null;
};

export type ApprovedStage = {
  group: string;
  /** Display string stored on the deal, such as "2 Financial screen". */
  stage: string;
  /** Short label, such as "Financial screen". */
  label: string;
  /** Value the feed tells the workbook writer to put in the Stage column. */
  token: string;
};

export type OverlayVerdict = "overlay" | "already" | "workbook";

export type StageRefresh = {
  targetKind: StageKind;
  targetId: string;
  stage: string;
  stageGroup: string;
};

export const STAGE_REFRESH_EVENT = "sites-stage-refresh";

const DISPLAY: Record<string, string> = {
  desk: "1 Desk screen",
  financial: "2 Financial screen",
  checks: "3 Site checks",
  close: "4 Offer and close",
  dropped: "Dropped",
  sourced: "Sourced",
};

export function stageKey(value: string | null | undefined): string {
  const raw = String(value || "").trim();
  const text = raw.toLowerCase();
  if (!text) return "";
  if (text.startsWith("dropped")) return "dropped";
  if (text === "desk" || text === "desk screen") return "desk";
  if (text === "financial" || text === "financial screen") return "financial";
  if (text === "checks" || text === "site checks") return "checks";
  if (text === "close" || text === "offer and close" || text === "later") return "close";
  if (text === "sourced") return "sourced";
  const match = /^\s*(\d+)\b/.exec(raw);
  if (!match) return "";
  const number = Number(match[1]);
  if (number <= 0) return "sourced";
  if (number === 1) return "desk";
  if (number === 2) return "financial";
  if (number === 3) return "checks";
  return "close";
}

export function displayStage(group: string, raw?: string): string {
  if (group === "dropped") return "Dropped";
  const proposed = String(raw || "").trim();
  if (proposed && stageKey(proposed) === group && /^\s*\d+\b/.test(proposed)) return proposed;
  return DISPLAY[group] || proposed;
}

/** Stage a decision would write. A duplicate of a record id is not a stage. */
export function approvedStage(input: {
  field: string;
  detail?: string | null;
  proposedValue?: string | null;
}): ApprovedStage | null {
  const field = input.field;
  const detail = String(input.detail || "");
  const proposed = String(input.proposedValue || "").trim();
  let group = "";
  let token = "";
  if (field === "proposed_next_step") {
    if (detail === "knock_off") {
      group = "dropped";
      token = "Dropped";
    } else if (detail === "stage_move" || detail === "bring_back") {
      group = stageKey(proposed);
      if (!group || group === "dropped" || group === "sourced") return null;
      token = proposed;
    } else if (detail === "mark_duplicate") {
      group = stageKey(proposed);
      if (!group) return null;
      token = group === "dropped" ? "Dropped" : proposed;
    } else {
      return null;
    }
  } else if (field === "stage" || (field === "correction" && (detail === "stage" || detail === "pipeline_stage"))) {
    group = stageKey(proposed);
    if (!group) return null;
    token = group === "dropped" ? "Dropped" : proposed;
  } else {
    return null;
  }
  return { group, stage: displayStage(group, proposed), label: stageTitle(group), token };
}

function baselineKey(decision: Pick<StageDecision, "field" | "stageAt" | "currentValue">): string {
  const recorded = stageKey(decision.stageAt || "");
  if (recorded) return recorded;
  if (decision.field === "proposed_next_step") return "";
  return stageKey(decision.currentValue || "");
}

export function overlayVerdict(
  workbookStage: string,
  decision: Pick<StageDecision, "field" | "detail" | "proposedValue" | "stageAt" | "currentValue">,
): OverlayVerdict {
  const approved = approvedStage(decision);
  if (!approved) return "workbook";
  const workbook = stageKey(workbookStage);
  if (workbook && workbook === approved.group) return "already";
  const baseline = baselineKey(decision);
  if (baseline && workbook && workbook !== baseline && workbook !== approved.group) return "workbook";
  return "overlay";
}

export function pendingNote(label: string, name: string, includeName: boolean): string {
  const who = includeName ? name.trim() : "";
  if (who) return `Moved to ${label} by ${who}, waiting for workbook`;
  return `Moved to ${label}, waiting for workbook`;
}

/** Feed line for an accepted stage change. Drops and bring-backs use the same sentence as a stage move. */
export function workbookInstruction(
  input: { status: string; field: string; detail?: string | null; proposedValue?: string | null },
  approver: boolean,
): { stage: string; line: string } | null {
  if (!approver || input.status !== "accepted") return null;
  const approved = approvedStage(input);
  if (!approved) return null;
  let shown = `${approved.label} (${approved.token})`;
  if (approved.group === "dropped") shown = "Dropped";
  else if (/^\s*\d+\b/.test(approved.token)) shown = approved.token.trim();
  return {
    stage: approved.token,
    line: `Approved stage: ${shown}. Write this stage on the workbook Stage column.`,
  };
}

export function stageDecisionMatchesWorkbook(
  row: { status: string; field: string; detail?: string | null; proposedValue?: string | null },
  record: Record<string, unknown> | null,
): boolean {
  if (row.status !== "accepted") return false;
  const approved = approvedStage(row);
  if (!approved || !record) return false;
  const workbook = stageKey(workbookStageOf(record));
  return Boolean(workbook) && workbook === approved.group;
}

function workbookStageOf(record: Record<string, unknown>): string {
  for (const key of ["stage", "pipeline_stage", "linked_deal_stage"]) {
    const value = String(record[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

function recency(decision: StageDecision): [number, number, string] {
  return [Date.parse(decision.decidedAt || "") || 0, Date.parse(decision.createdAt || "") || 0, decision.id];
}

function laterThan(candidate: StageDecision, current: StageDecision): boolean {
  const left = recency(candidate);
  const right = recency(current);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] === right[index]) continue;
    return left[index] > right[index];
  }
  return false;
}

function featureStage(properties: Record<string, unknown>, kind: StageKind): string {
  if (kind === "deal") return String(properties.stage || "");
  return String(properties.linked_deal_stage || properties.pipeline_stage || properties.stage || "");
}

function keysFor(kind: StageKind, id: string, links: StageLink[]): Set<string> {
  const keys = new Set<string>([`${kind}:${id}`]);
  for (const link of links) {
    if (!link.dealId || !link.siteId) continue;
    if (kind === "deal" && link.dealId === id) keys.add(`site:${link.siteId}`);
    if (kind === "site" && link.siteId === id) keys.add(`deal:${link.dealId}`);
  }
  return keys;
}

function latestDecision(keys: Set<string>, grouped: Map<string, StageDecision[]>): StageDecision | null {
  let best: StageDecision | null = null;
  for (const key of keys) {
    for (const decision of grouped.get(key) || []) {
      if (!best || laterThan(decision, best)) best = decision;
    }
  }
  return best;
}

function paint(
  properties: Record<string, unknown>,
  kind: StageKind,
  approved: ApprovedStage,
  note: string,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...properties, stage_pending: note };
  if (kind === "deal") {
    next.stage = approved.stage;
    next.stage_group = approved.group;
  } else {
    next.pipeline_stage = approved.stage;
    next.linked_deal_stage = approved.stage;
  }
  if (approved.group === "dropped") delete next.suggested_drop;
  return next;
}

export function applyStageOverlay<T extends { features?: { properties?: Record<string, unknown> }[] }>(
  file: T,
  decisions: StageDecision[],
  options: { kind: StageKind; links?: StageLink[]; includeNames?: boolean },
): T {
  const features = file.features;
  if (!features?.length || !decisions.length) return file;
  const grouped = new Map<string, StageDecision[]>();
  for (const decision of decisions) {
    if (decision.status !== "accepted") continue;
    if (!approvedStage(decision)) continue;
    const key = `${decision.targetKind}:${decision.targetId}`;
    const list = grouped.get(key) || [];
    list.push(decision);
    grouped.set(key, list);
  }
  if (!grouped.size) return file;
  const links = options.links || [];
  const includeNames = options.includeNames !== false;
  let changed = false;
  const nextFeatures = features.map((feature) => {
    const properties = feature.properties;
    if (!properties) return feature;
    const id = String(properties[options.kind === "deal" ? "deal_id" : "site_id"] || "");
    if (!id) return feature;
    const decision = latestDecision(keysFor(options.kind, id, links), grouped);
    if (!decision) return feature;
    const verdict = overlayVerdict(featureStage(properties, options.kind), decision);
    if (verdict !== "overlay") return feature;
    const approved = approvedStage(decision);
    if (!approved) return feature;
    changed = true;
    return {
      ...feature,
      properties: paint(properties, options.kind, approved, pendingNote(approved.label, decision.actorName, includeNames)),
    };
  });
  if (!changed) return file;
  return { ...file, features: nextFeatures };
}

export function refreshFromSuggestion(
  targetKind: StageKind,
  targetId: string,
  suggestion: { status?: string; field?: string; detail?: string | null; proposedValue?: string | null },
): StageRefresh | null {
  if (suggestion.status !== "accepted") return null;
  const approved = approvedStage({
    field: String(suggestion.field || ""),
    detail: suggestion.detail,
    proposedValue: suggestion.proposedValue,
  });
  if (!approved) return null;
  return { targetKind, targetId, stage: approved.stage, stageGroup: approved.group };
}

export function publishStageRefresh(detail: StageRefresh) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(STAGE_REFRESH_EVENT, { detail }));
}

type StageFeature = { properties?: Record<string, unknown> };

export function patchLiveStage<D extends { features: StageFeature[] }, S extends { features: StageFeature[] }>(
  input: { deals: D; sites: S },
  detail: StageRefresh,
): { deals: D; sites: S } {
  const dealIds = new Set<string>();
  const siteIds = new Set<string>();
  if (detail.targetKind === "deal") {
    dealIds.add(detail.targetId);
    for (const feature of input.sites.features) {
      const properties = feature.properties || {};
      if (String(properties.linked_deal_id || "") === detail.targetId) siteIds.add(String(properties.site_id || ""));
    }
    for (const feature of input.deals.features) {
      const properties = feature.properties || {};
      if (String(properties.deal_id || "") === detail.targetId) {
        const universe = String(properties.universe_id || "");
        if (universe) siteIds.add(universe);
      }
    }
  } else {
    siteIds.add(detail.targetId);
    for (const feature of input.sites.features) {
      const properties = feature.properties || {};
      if (String(properties.site_id || "") === detail.targetId) {
        const dealId = String(properties.linked_deal_id || "");
        if (dealId) dealIds.add(dealId);
      }
    }
    for (const feature of input.deals.features) {
      const properties = feature.properties || {};
      if (String(properties.universe_id || "") === detail.targetId) dealIds.add(String(properties.deal_id || ""));
    }
  }
  const paintDeal = (properties: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...properties, stage: detail.stage, stage_group: detail.stageGroup };
    if (detail.stageGroup === "dropped") delete next.suggested_drop;
    return next;
  };
  const paintSite = (properties: Record<string, unknown>) => ({
    ...properties,
    pipeline_stage: detail.stage,
    linked_deal_stage: detail.stage,
  });
  return {
    deals: {
      ...input.deals,
      features: input.deals.features.map((feature) => {
        const properties = feature.properties;
        if (!properties || !dealIds.has(String(properties.deal_id || ""))) return feature;
        return { ...feature, properties: paintDeal(properties) };
      }),
    },
    sites: {
      ...input.sites,
      features: input.sites.features.map((feature) => {
        const properties = feature.properties;
        if (!properties || !siteIds.has(String(properties.site_id || ""))) return feature;
        return { ...feature, properties: paintSite(properties) };
      }),
    },
  };
}
