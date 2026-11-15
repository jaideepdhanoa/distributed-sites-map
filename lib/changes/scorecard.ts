import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Scorecard = {
  version: number;
  weights: {
    economics: number;
    land: number;
    power: number;
    location: number;
    deal: number;
  };
  location_points: {
    Inside: number;
    "Near 0-5": number;
    "Near 5-10": number;
    Outside: number;
  };
};

/** The committed rule. Workbook cells are not the source for these weights. */
export function loadScorecard(): Scorecard {
  const file = join(process.cwd(), "config", "scorecard.json");
  return JSON.parse(readFileSync(file, "utf8")) as Scorecard;
}

export function scorecardTotal(card: Scorecard = loadScorecard()): number {
  const weights = card.weights;
  return weights.economics + weights.land + weights.power + weights.location + weights.deal;
}

/**
 * The workbook score and Location points cell are stored as written.
 * The weights and the location scale are not applied.
 */
export function recordedScore(value: number | null): number | null {
  return value;
}

export function recordedLocationPoints(value: number | null): number | null {
  return value;
}
