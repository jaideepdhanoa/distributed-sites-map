import { readGenerated } from "@/lib/guard";
import { droppedStage } from "@/lib/actions/nextStepTypes";
import { recommendedDropSummary } from "@/lib/actions/nextStep";
import { stageKey } from "@/lib/stageOverlay";
import type { TimelineItem } from "@/lib/timeline/filter";

export type SuggestedDrop = { id: string; stage: string; reason: string; afterDesk?: boolean };

const PAST_DESK = new Set(["financial", "checks", "close", "contacted", "later"]);

/**
 * A suggested drop is a Desk screen knock-out. Once the workbook has moved the
 * site to Financial screen or later, the suggestion stays off unless the rule
 * that produced it says it still applies (`afterDesk`).
 */
export function suggestedDropVisible(stage: unknown, stageGroup?: unknown, afterDesk = false): boolean {
  if (afterDesk) return !droppedStage(stageGroup == null ? null : String(stageGroup), stage == null ? null : String(stage));
  const key = stageKey(String(stage || "")) || String(stageGroup || "").trim().toLowerCase();
  return !PAST_DESK.has(key);
}

type DealFile = { features?: { properties?: Record<string, unknown> }[] };

export function loadSuggestedDrops(): SuggestedDrop[] {
  try {
    const raw = readGenerated("suggested_drops.json") as unknown;
    if (!Array.isArray(raw)) return [];
    const rows: SuggestedDrop[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const id = String(row.id || "").trim();
      const stage = String(row.stage || "").trim();
      const reason = String(row.reason || "").trim();
      if (!id || !stage || !reason || droppedStage(null, stage)) continue;
      const afterDesk = row.afterDesk === true;
      if (!suggestedDropVisible(stage, null, afterDesk)) continue;
      rows.push({ id, stage, reason, ...(afterDesk ? { afterDesk: true } : {}) });
    }
    return rows;
  } catch {
    return [];
  }
}

export function withSuggestedDrops<T extends DealFile>(file: T): T {
  const features = file.features;
  if (!features) return file;
  const drops = new Map(loadSuggestedDrops().map((row) => [row.id, row]));
  return {
    ...file,
    features: features.map((feature) => {
      const props = feature.properties;
      if (!props) return feature;
      const drop = drops.get(String(props.deal_id || ""));
      if (!drop) return feature;
      const stage = String(props.stage || "");
      const group = String(props.stage_group || "");
      if (droppedStage(group, stage)) return feature;
      if (!suggestedDropVisible(stage || drop.stage, group, drop.afterDesk === true)) return feature;
      if (stage && stage !== drop.stage) return feature;
      return { ...feature, properties: { ...props, suggested_drop: drop.reason } };
    }),
  };
}

export function suggestedReason(id: string, stage: unknown, stageGroup: unknown): string {
  const drop = loadSuggestedDrops().find((row) => row.id === id);
  if (!drop) return "";
  const text = String(stage || "");
  const group = String(stageGroup || "");
  if (droppedStage(group, text)) return "";
  if (!suggestedDropVisible(text || drop.stage, group, drop.afterDesk === true)) return "";
  if (text && text !== drop.stage) return "";
  return drop.reason;
}

export function suggestedDropHistory(ids: string[]): TimelineItem[] {
  const wanted = new Set(ids.map((id) => id.trim()).filter(Boolean));
  const items: TimelineItem[] = [];
  for (const drop of loadSuggestedDrops()) {
    if (!wanted.has(drop.id)) continue;
    items.push({
      date: "",
      type: "drop_suggested",
      summary: recommendedDropSummary(drop.reason),
      eventId: `suggested-drop:${drop.id}`,
    });
  }
  return items;
}
