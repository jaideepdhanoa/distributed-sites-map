/** One counter per concept. The Review badge, the list chips, and the funnel all call these. */

export const KNOWN_MARKETS = ["PHX", "LAS", "MIA"] as const;
export type KnownMarket = (typeof KNOWN_MARKETS)[number];
export type MarketBucket = KnownMarket | "Other";

export function marketBucket(city: string | null | undefined): MarketBucket {
  const code = String(city || "").trim().toUpperCase();
  if (code === "PHX" || code === "LAS" || code === "MIA") return code;
  return "Other";
}

export type MarketTotals = Record<"All" | MarketBucket, number>;

/** Market chips. PHX + LAS + MIA + Other equals All. */
export function marketCounts(rows: readonly { city?: string | null }[]): MarketTotals {
  const counts: MarketTotals = { All: rows.length, PHX: 0, LAS: 0, MIA: 0, Other: 0 };
  for (const row of rows) counts[marketBucket(row.city)] += 1;
  return counts;
}

export function inCountedMarket(city: string | null | undefined, selected: string): boolean {
  if (!selected || selected === "all") return true;
  if (selected === "other") return marketBucket(city) === "Other";
  return marketBucket(city) === marketBucket(selected);
}

export type StepParts = { operating: number; land: number };

/** Pipeline step totals count operating businesses. Land is its own count (R-108). */
export function stepParts(rows: readonly { kind?: string | null; stage_group?: string | null }[], step: string): StepParts {
  let operating = 0;
  let land = 0;
  for (const row of rows) {
    if (row.stage_group !== step) continue;
    if (row.kind === "land") land += 1;
    else operating += 1;
  }
  return { operating, land };
}

/** All chip. The number is what this view shows. Hidden dropped deals sit beside it. */
export function droppedChip(shown: number, hiddenDropped: number): { count: string; aside: string; title: string } {
  const count = Math.max(0, shown).toLocaleString("en-US");
  if (hiddenDropped <= 0) return { count, aside: "", title: "Deals this view shows." };
  return {
    count,
    aside: `incl. ${hiddenDropped.toLocaleString("en-US")}`,
    title: `${count} shown. ${hiddenDropped.toLocaleString("en-US")} dropped stay off until that step is open.`,
  };
}

/** The badge matches the queue Review opens. A narrowed map says that queue is all markets. */
export function reviewBadge(input: { count: number; allMarkets: boolean }): { count: number; label: string } {
  return { count: Math.max(0, input.count), label: input.allMarkets ? "" : "all markets" };
}

export type LabeledCount = { id: string; label: string; count: number };

export function labeledCount(id: string, label: string, count: number): LabeledCount {
  return { id, label, count: Math.max(0, count) };
}

/** Workbook date and the newest app event. The later day wins. */
export function latestTouch(workbook: string | null | undefined, eventDates: readonly string[]): string {
  const days = [workbook || "", ...eventDates]
    .map((value) => String(value || "").slice(0, 10))
    .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day));
  days.sort();
  return days.at(-1) || "";
}
