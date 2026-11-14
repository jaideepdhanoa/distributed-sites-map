export type StripDirection = "higher" | "lower" | "neutral";

export type StripTone = "neutral" | "better" | "worse" | "negative";

export type StripStats = {
  min: number;
  max: number;
  median: number;
  count: number;
  values: number[];
  /** True when a zero tick belongs on the track. */
  zero: boolean;
};

export type StripPlace = {
  left: number;
  medianLeft: number;
  zeroLeft: number | null;
  tone: StripTone;
  rank: number;
  count: number;
  median: number;
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function stripStats(values: Array<number | null | undefined>, anchorZero = false): StripStats | null {
  const nums = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!nums.length) return null;
  let min = Math.min(...nums);
  let max = Math.max(...nums);
  const hasNegative = nums.some((value) => value < 0);
  const zero = anchorZero && hasNegative;
  if (zero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  return { min, max, median: median(nums), count: nums.length, values: nums, zero };
}

export function stripLeft(value: number, stats: StripStats): number {
  if (stats.max === stats.min) return 50;
  const ratio = (value - stats.min) / (stats.max - stats.min);
  return Math.min(100, Math.max(0, ratio * 100));
}

/** Rank 1 is the better end when direction is set, otherwise the lowest value. Ties share a rank. */
export function stripRank(value: number, values: number[], direction: StripDirection): number {
  const ordered = [...values].sort((a, b) => (direction === "higher" ? b - a : a - b));
  let rank = 1;
  for (let index = 0; index < ordered.length; index += 1) {
    if (index > 0 && ordered[index] !== ordered[index - 1]) rank = index + 1;
    if (ordered[index] === value) return rank;
  }
  return rank;
}

export function stripTone(value: number, stats: StripStats, direction: StripDirection, markNegative = false): StripTone {
  if (markNegative && value < 0) return "negative";
  if (direction === "neutral" || stats.max === stats.min) return "neutral";
  const ratio = (value - stats.min) / (stats.max - stats.min);
  const low = ratio <= 1 / 3;
  const high = ratio >= 2 / 3;
  if (direction === "higher") {
    if (high) return "better";
    if (low) return "worse";
    return "neutral";
  }
  if (low) return "better";
  if (high) return "worse";
  return "neutral";
}

export function stripPlace(value: number, stats: StripStats, direction: StripDirection, markNegative = false): StripPlace {
  return {
    left: stripLeft(value, stats),
    medianLeft: stripLeft(stats.median, stats),
    zeroLeft: stats.zero ? stripLeft(0, stats) : null,
    tone: stripTone(value, stats, direction, markNegative),
    rank: stripRank(value, stats.values, direction),
    count: stats.count,
    median: stats.median,
  };
}

export function stripTip(valueText: string, medianText: string, rank: number, count: number): string {
  return `${valueText} · median ${medianText} · rank ${rank} of ${count} in this filter`;
}
