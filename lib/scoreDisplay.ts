import { displayScore } from "./keyNumbers";

/** Rubric maxima. These are weights, not a site's subscores. */
export const SCORE_MAX = {
  economics: 40,
  land: 25,
  power: 15,
  location: 10,
  deal: 10,
} as const;

export type ScoreDimension = keyof typeof SCORE_MAX;

export type ScorePart = {
  id: ScoreDimension;
  label: string;
  value: string;
  max: number;
};

const ORDER: ScoreDimension[] = ["economics", "land", "power", "location", "deal"];

const LABELS: Record<ScoreDimension, string> = {
  economics: "Economics",
  land: "Land",
  power: "Power",
  location: "Location",
  deal: "Deal",
};

export type StoredScoreInput = {
  score?: number | string | null;
  economics?: number | string | null;
  land?: number | string | null;
  power?: number | string | null;
  locationPoints?: number | string | null;
  deal?: number | string | null;
};

/**
 * The total, plus only the dimension numbers that were actually stored.
 * Missing dimensions are named and left blank. Nothing is back-calculated.
 */
export function storedScoreView(input: StoredScoreInput): {
  total: string;
  parts: ScorePart[];
  line: string;
  missing: string[];
} {
  const stored: Partial<Record<ScoreDimension, string>> = {
    economics: displayScore(input.economics),
    land: displayScore(input.land),
    power: displayScore(input.power),
    location: displayScore(input.locationPoints),
    deal: displayScore(input.deal),
  };
  const parts: ScorePart[] = [];
  const missing: string[] = [];
  for (const id of ORDER) {
    const value = stored[id];
    if (!value) {
      missing.push(LABELS[id]);
      continue;
    }
    parts.push({ id, label: LABELS[id], value, max: SCORE_MAX[id] });
  }
  return {
    total: displayScore(input.score),
    parts,
    line: parts.map((part) => `${part.label} ${part.value}/${part.max}`).join(", "),
    missing,
  };
}

export function missingScoreSentence(missing: string[]): string {
  if (!missing.length) return "";
  const names = missing.length === 1
    ? missing[0]
    : missing.length === 2
      ? `${missing[0]} and ${missing[1]}`
      : `${missing.slice(0, -1).join(", ")}, and ${missing[missing.length - 1]}`;
  const verb = missing.length === 1 ? "is" : "are";
  return `${names} ${verb} not stored per site.`;
}
