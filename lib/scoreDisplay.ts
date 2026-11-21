import { displayScore } from "./keyNumbers";

/** Rubric maxima from the workbook headers. Not used to recompute a score. */
export const SCORE_MAX = {
  economics: 40,
  land: 25,
  power: 15,
  location: 10,
  deal: 10,
} as const;

export type ScoreDimension = keyof typeof SCORE_MAX;

const ORDER: ScoreDimension[] = ["economics", "land", "power", "location", "deal"];

const LABELS: Record<ScoreDimension, string> = {
  economics: "Economics",
  land: "Land",
  power: "Power",
  location: "Location",
  deal: "Deal",
};

const AREA_LABEL: Record<string, string> = {
  inside: "Inside",
  near_0_5: "Near 0-5",
  near_5_10: "Near 5-10",
  outside: "Outside",
  unknown: "Unknown",
  edge_legacy: "Edge",
};

export const POWER_SCORE_NOTE = "Unknown default, power rating not yet scored";
export const HALF_CREDIT_NOTE = "Unknown, half credit";

export type StoredScoreInput = {
  score?: number | string | null;
  economics?: number | string | null;
  land?: number | string | null;
  power?: number | string | null;
  location?: number | string | null;
  deal?: number | string | null;
  savingVsHub?: string | null;
  stalls?: number | string | null;
  serviceArea?: string | null;
  dealRating?: string | null;
  /** Derived power reason. The copied power points stay as stored. */
  powerDetail?: string | null;
  /** Quick lube is not ranked on wash cash flow. Economics shows N/A, not zero. */
  naEconomics?: boolean;
};

export type ScoreLine = {
  id: ScoreDimension;
  label: string;
  shown: string;
  max: number;
  detail: string;
};

/**
 * Display of the copied workbook cells. Missing points stay a dash.
 * The five numbers are not changed when they disagree with the total.
 */
export function storedScoreView(input: StoredScoreInput): {
  total: string;
  summed: string;
  chip: string;
  status: "scored" | "provisional" | "not_scored";
  line: string;
  parts: ScoreLine[];
  mismatch: boolean;
} {
  const numbers = {
    economics: pointNumber(input.economics),
    land: pointNumber(input.land),
    power: pointNumber(input.power),
    location: pointNumber(input.location),
    deal: pointNumber(input.deal),
  };
  const details: Record<ScoreDimension, string> = {
    economics: economicsDetail(input.savingVsHub),
    land: landDetail(input.stalls),
    power: powerDetail(input.powerDetail),
    location: locationDetail(input.serviceArea),
    deal: dealDetail(input.dealRating),
  };
  const parts = ORDER.map((id) => {
    const value = numbers[id];
    const na = id === "economics" && input.naEconomics;
    return {
      id,
      label: LABELS[id],
      shown: na ? "N/A" : value == null ? "—" : formatPoints(value),
      max: SCORE_MAX[id],
      detail: na ? "Wash cash flow does not apply." : details[id],
    };
  });
  const totalNumber = pointNumber(input.score);
  const economicsMissing = !input.naEconomics && numbers.economics == null;
  const present = ORDER.filter((id) => !(id === "economics" && input.naEconomics)).map((id) => numbers[id]);
  // Parts are shown to one decimal. Compare that shown sum with the total at the same decimal.
  const shownSum = present.every((value) => value != null)
    ? present.reduce((sum, value) => sum + Number(formatPoints(value || 0)), 0)
    : null;
  const shownTotal = totalNumber == null ? null : Number(formatPoints(totalNumber));
  const mismatch = !economicsMissing && shownTotal != null && shownSum != null && Math.abs(shownSum - shownTotal) > 0.001;
  const total = displayScore(input.score);
  const summed = shownSum == null ? "" : formatPoints(shownSum);
  const status = economicsMissing ? "not_scored" : mismatch ? "provisional" : "scored";
  return {
    total,
    summed,
    chip: status === "not_scored" ? "Not scored" : status === "provisional" ? "Provisional" : shownTotal == null ? "" : formatPoints(totalNumber as number),
    status,
    line: parts.map((part) => `${part.label} ${part.shown}/${part.max}`).join(" · "),
    parts,
    mismatch,
  };
}

/** One decimal, with a trailing .0 removed. The stored cell is not rewritten. */
/** True when the score chip is Provisional or Not scored. */
export function scoreIssue(input: StoredScoreInput): boolean {
  const status = storedScoreView(input).status;
  return status === "provisional" || status === "not_scored";
}

export function formatPoints(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const text = Object.is(rounded, -0) ? "0.0" : rounded.toFixed(1);
  return text.endsWith(".0") ? text.slice(0, -2) : text;
}

function pointNumber(value: unknown): number | null {
  const text = displayScore(value);
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function economicsDetail(value: string | null | undefined): string {
  const text = String(value || "").trim();
  return text ? `Saving vs. hub at screening price %: ${text}` : "Saving vs. hub at screening price %: —";
}

function landDetail(value: number | string | null | undefined): string {
  if (value == null || String(value).trim() === "") return `Stalls that fit: ${HALF_CREDIT_NOTE}`;
  const text = displayScore(value);
  if (!text) return `Stalls that fit: ${HALF_CREDIT_NOTE}`;
  const number = Number(text);
  const shown = Number.isInteger(number) ? String(number) : formatPoints(number);
  return `Stalls that fit: ${shown}`;
}

function powerDetail(value: string | null | undefined): string {
  const text = String(value || "").trim();
  return text || POWER_SCORE_NOTE;
}

function locationDetail(value: string | null | undefined): string {
  const raw = String(value || "").trim();
  const label = AREA_LABEL[raw] || raw;
  return label ? `Inside the service area: ${label}` : "Inside the service area: —";
}

function dealDetail(value: string | null | undefined): string {
  const text = String(value || "").trim();
  return text ? `Deal rating: ${text}` : `Deal rating: ${HALF_CREDIT_NOTE}`;
}
