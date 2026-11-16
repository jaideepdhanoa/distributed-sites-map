import { BUSINESS_LABELS, LINE_LABELS, type PnlBusiness, type PnlLineCode } from "./lines";
import { outsideBand, percentOf } from "./money";

/**
 * Screening bands, as a percent of stated revenue for the same period.
 *
 * Car wash ranges follow published express-exterior planning ranges
 * (Wash Launch Group, Greenfield car wash pro forma, 2026): labor 15–22%,
 * chemistry 5–7%, utilities 6–9%, repairs and maintenance 5–8%, marketing 3–6%,
 * stabilized EBITDA about 40–55% by revenue tier. Labor and utilities are
 * widened to include full-service washes, where Auto Laundry News describes
 * labor near 40% of sales and utilities trending from about 5% to 10%.
 *
 * Auto service ranges follow IRS sole-proprietorship returns for auto repair
 * (about 34% parts, 13% labor, 6% rent, 3% utilities; ProjectionHub summary of
 * the 2019 Statistics of Income) and shop benchmarks (rent near 4.5% and
 * advertising near 2.9% in the Paar Melis shop report; staffed shops often
 * cite parts at 38–45% and labor at 25–35%).
 *
 * A line with no cited band is not flagged. Add-backs are never compared
 * with operating bands. The percent is a ratio of two captured figures.
 */
export type Band = { low: number; high: number; because: string };

export const BANDS: Record<PnlBusiness, Partial<Record<PnlLineCode, Band>>> = {
  car_wash: {
    labor: {
      low: 15,
      high: 40,
      because: "Express planning ranges are 15–22%, and full-service labor runs near 40% of sales.",
    },
    chemicals: {
      low: 5,
      high: 7,
      because: "Express chemistry planning range is 5–7% of revenue.",
    },
    utilities: {
      low: 5,
      high: 12,
      because: "Express utilities are often 6–9%, and full-service utilities have run from about 5% to 10%.",
    },
    repairs: {
      low: 3,
      high: 10,
      because: "Express repairs and maintenance are often 5–8% of revenue.",
    },
    marketing: {
      low: 2,
      high: 8,
      because: "Express marketing planning range is 3–6% of revenue.",
    },
    ebitda: {
      low: 40,
      high: 55,
      because: "Stabilized express EBITDA is often 40–55% of revenue.",
    },
  },
  auto_service: {
    cogs: {
      low: 30,
      high: 45,
      because: "Parts are about a third of sales on tax returns, and staffed shops often run 38–45%.",
    },
    labor: {
      low: 13,
      high: 35,
      because: "Sole-proprietor returns show labor near 13% when owner pay is left out. Staffed shops often run 25–35%.",
    },
    occupancy: {
      low: 4,
      high: 10,
      because: "Shop rent is often about 4.5–6% of sales, and a well-located shop is cited up to about 10%.",
    },
    utilities: {
      low: 2,
      high: 5,
      because: "Utilities are about 3% of sales on sole-proprietor returns.",
    },
    marketing: {
      low: 1,
      high: 5,
      because: "Advertising averages about 3% of sales in shop benchmarks.",
    },
  },
};

export type LineFlag = { reason: string };

export function flagLine(input: {
  code: PnlLineCode;
  cents: bigint;
  business: PnlBusiness;
  revenueCents: bigint | null;
  revenueStatus: "reported" | "estimated" | null;
  status: "reported" | "estimated";
}): LineFlag | null {
  const label = LINE_LABELS[input.code];
  if (input.code.startsWith("revenue_") && input.revenueCents != null && input.revenueCents > BigInt(0)) {
    const abs = input.cents < BigInt(0) ? -input.cents : input.cents;
    if (abs > input.revenueCents) return { reason: `${label} is larger than stated revenue on this period.` };
  }
  if (input.revenueCents == null || input.revenueCents <= BigInt(0)) return null;
  const band = BANDS[input.business][input.code];
  if (!band || !outsideBand(input.cents, input.revenueCents, band.low, band.high)) return null;
  const share = percentOf(input.cents, input.revenueCents);
  if (!share) return null;
  const business = BUSINESS_LABELS[input.business].toLowerCase();
  const estimated = [
    input.status === "estimated" ? "This figure is estimated." : "",
    input.revenueStatus === "estimated" ? "Stated revenue on this period is estimated." : "",
  ].filter(Boolean);
  const tail = estimated.length ? ` ${estimated.join(" ")}` : "";
  return {
    reason: `${label} is ${share} of stated revenue, outside the ${business} band of ${band.low}–${band.high}%. ${band.because}${tail}`,
  };
}
