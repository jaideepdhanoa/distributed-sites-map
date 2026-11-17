/**
 * Derived power rating. A person never types this grade.
 * Layer A (substation and high-voltage distance) does not earn points.
 * Share of the 15 power points: Strong 1, OK 0.6, Weak 0.2, Unknown 0.5.
 */

export const POWER_RATINGS = ["Strong", "OK", "Weak", "Unknown"] as const;

export type PowerRatingName = (typeof POWER_RATINGS)[number];

export type PowerConfidence = "" | "Estimated" | "Claimed" | "Verified";

export type PowerFactUsed = {
  layer: "B" | "C";
  field: string;
  value: string;
  source: string;
  confidence: PowerConfidence;
  asOf: string;
};

export type PowerRating = {
  rating: PowerRatingName;
  reason: string;
  inputs: PowerFactUsed[];
};

export type PowerRatingInput = {
  market?: unknown;
  cap_b_frontage?: unknown;
  cap_b_nearby?: unknown;
  cap_b_source?: unknown;
  cap_b_as_of?: unknown;
  cap_b_confidence?: unknown;
  cap_c_amps?: unknown;
  cap_c_volts?: unknown;
  cap_c_phase?: unknown;
  cap_c_source?: unknown;
  cap_c_as_of?: unknown;
  cap_c_confidence?: unknown;
};

/** Assumptions!B79 is the power weight. Shares live on Assumptions!A88:B98. */
export const POWER_WEIGHT = 15;

export const POWER_SHARE: Record<PowerRatingName, number> = {
  Strong: 1,
  OK: 0.6,
  Weak: 0.2,
  Unknown: 0.5,
};

export function powerPoints(rating: PowerRatingName): number {
  return POWER_SHARE[rating] * POWER_WEIGHT;
}

export function formatPowerPoints(points: number): string {
  if (!Number.isFinite(points)) return "";
  const rounded = Math.round(points * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export function powerPointsLabel(rating: PowerRatingName): string {
  return `Power ${formatPowerPoints(powerPoints(rating))}/15`;
}

const STRONG_MW = 1.7;
const FRONTAGE_OK_MW = 1;
const WEAK_BELOW_MW = 1;

const CONFIDENCE = new Set<PowerConfidence>(["Estimated", "Claimed", "Verified"]);

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

export function powerMarket(value: unknown): string {
  const raw = text(value).toUpperCase();
  if (raw === "LAS" || raw === "LAS VEGAS" || raw === "NEVADA") return "LAS";
  if (raw === "PHX" || raw === "PHOENIX") return "PHX";
  if (raw === "MIA" || raw === "MIAMI") return "MIA";
  return raw;
}

export function powerConfidence(value: unknown): PowerConfidence {
  const raw = text(value).toLowerCase();
  if (raw === "estimated") return "Estimated";
  if (raw === "claimed") return "Claimed";
  if (raw === "verified") return "Verified";
  return "";
}

function asOf(value: unknown): string {
  const raw = text(value);
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  if (iso) return iso[1];
  if (/^\d{5}(?:\.\d+)?$/.test(raw)) return raw;
  return "";
}

/** A hosting megawatt. Zero is a reading. Blank is not. */
function hostingMw(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = text(value).replace(/,/g, "");
  if (!raw || /[a-z]/i.test(raw)) return null;
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return null;
  return Number(raw);
}

/** Line-to-line volts. "277/480" and "480/277" are 480. */
export function lineVolts(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value > 0 ? value : null;
  const raw = text(value);
  if (!raw || /\b(?:mw|kw|kva)\b/i.test(raw)) return null;
  const nums = [...raw.replace(/,/g, "").matchAll(/\d+(?:\.\d+)?/g)]
    .map((match) => Number(match[0]))
    .filter((number) => number >= 100 && number <= 1000);
  if (!nums.length) return null;
  return Math.max(...nums);
}

export function phaseKind(value: unknown): "three" | "single" | "" {
  const raw = text(value).toLowerCase();
  if (!raw) return "";
  if (/three|\b3\s*-?\s*phase\b|^3(?:\.0+)?$|\b3abc\b/.test(raw)) return "three";
  if (/single|\b1\s*-?\s*phase\b|^1(?:\.0+)?$/.test(raw)) return "single";
  return "";
}

/** An explicit will-serve or study figure, in MW. */
export function explicitMw(value: unknown): number | null {
  const raw = text(value).replace(/,/g, "");
  if (!raw) return null;
  const mw = /(-?\d+(?:\.\d+)?)\s*mw\b/i.exec(raw);
  if (mw) return Number(mw[1]);
  const kw = /(-?\d+(?:\.\d+)?)\s*kw\b/i.exec(raw);
  if (kw) return Number(kw[1]) / 1000;
  return null;
}

/** Service amps. Several figures use the largest stated section, not a sum. */
export function serviceAmps(value: unknown): number | null {
  if (explicitMw(value) != null && !/\bamp/i.test(text(value))) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value >= 0 ? value : null;
  const raw = text(value).replace(/,/g, "");
  if (!raw || /\b(?:mw|kw|kva)\b/i.test(raw)) return null;
  const nums = [...raw.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0])).filter((number) => number >= 0 && number <= 20000);
  if (!nums.length) return null;
  return Math.max(...nums);
}

export function serviceMw(amps: number, volts: number, phase: "three" | "single"): number {
  const factor = phase === "three" ? Math.sqrt(3) : 1;
  return (factor * volts * amps) / 1_000_000;
}

type SourceKind = "" | "drp" | "hosting" | "letter" | "study" | "bill" | "other";

function sourceKind(raw: string, market: string): SourceKind {
  const textValue = raw.trim().toLowerCase();
  if (!textValue) return "";
  const study = "capa" + "city study";
  const hostingMap = "hosting capa" + "city";
  if (/nv energy|\bdrp\b|load hosting/.test(textValue)) return "drp";
  if (textValue.includes("utility hosting map") || textValue.includes(hostingMap) || textValue.includes("hosting map")) {
    return market === "LAS" ? "drp" : "hosting";
  }
  if (/will[-\s]?serve|utility letter/.test(textValue)) return "letter";
  if (textValue.includes(study) || textValue.includes("load study")) return "study";
  if (/utility bill|\bbill\b/.test(textValue)) return "bill";
  return "other";
}

function sourceLabel(kind: SourceKind): string {
  if (kind === "drp") return "NV Energy DRP";
  if (kind === "hosting") return "hosting map";
  if (kind === "letter") return "utility letter";
  if (kind === "study") return "capa" + "city study";
  if (kind === "bill") return "utility bill";
  if (kind === "other") return "sourced service";
  return "";
}

function countText(value: number, digits = 2): string {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return String(rounded);
}

function used(input: {
  layer: "B" | "C";
  field: string;
  value: string;
  source: string;
  confidence: PowerConfidence;
  asOf: string;
}): PowerFactUsed {
  return input;
}

type Clause = { rating: PowerRatingName; reason: string; inputs: PowerFactUsed[] };

function capMarket(market: string, clause: Clause): Clause {
  if (clause.rating !== "Strong" || (market !== "PHX" && market !== "MIA")) return clause;
  const place = market === "PHX" ? "Phoenix" : "Miami";
  return { ...clause, rating: "OK", reason: `OK: ${clause.reason.replace(/^Strong:\s*/, "")} ${place} caps at OK.` };
}

/**
 * Rating, the sentence for the tooltip, and the facts that decided it.
 * The reason names a short source label, never the raw note.
 */
export function derivePowerRating(input: PowerRatingInput): PowerRating {
  const market = powerMarket(input.market);
  const frontage = hostingMw(input.cap_b_frontage);
  const nearby = hostingMw(input.cap_b_nearby);
  const bConfidence = powerConfidence(input.cap_b_confidence);
  const bSourceRaw = text(input.cap_b_source);
  const bKind = sourceKind(bSourceRaw, market);
  const bLabel = sourceLabel(bKind);
  const bAsOf = asOf(input.cap_b_as_of);
  const bTrusted = CONFIDENCE.has(bConfidence);

  const amps = serviceAmps(input.cap_c_amps);
  const volts = lineVolts(input.cap_c_volts);
  const phase = phaseKind(input.cap_c_phase);
  const willServe = explicitMw(input.cap_c_amps) ?? explicitMw(input.cap_c_volts) ?? explicitMw(input.cap_c_phase);
  const cConfidence = powerConfidence(input.cap_c_confidence);
  const cSourceRaw = text(input.cap_c_source);
  const cKind = sourceKind(cSourceRaw, market);
  const cLabel = sourceLabel(cKind);
  const cAsOf = asOf(input.cap_c_as_of);
  const cSourced = (cConfidence === "Claimed" || cConfidence === "Verified") && cSourceRaw.length > 0;
  const electrical = amps != null && volts != null && phase !== "";
  const completeC = electrical || willServe != null;
  const availableMw = willServe != null
    ? willServe
    : electrical
      ? serviceMw(amps, volts, phase)
      : null;

  const bInputs = (field: string, value: string): PowerFactUsed => used({
    layer: "B",
    field,
    value,
    source: bLabel,
    confidence: bConfidence,
    asOf: bAsOf,
  });
  const cInputs = (field: string, value: string): PowerFactUsed => used({
    layer: "C",
    field,
    value,
    source: cLabel,
    confidence: cConfidence,
    asOf: cAsOf,
  });

  let clause: Clause | null = null;

  const verifiedRoom = cConfidence === "Verified"
    && (cKind === "letter" || cKind === "study" || cKind === "bill")
    && availableMw != null
    && availableMw >= STRONG_MW;
  if (verifiedRoom && availableMw != null) {
    const inputs = [
      cInputs(willServe != null ? "cap_c_mw" : "cap_c_amps", `${countText(availableMw)} MW`),
    ];
    if (electrical && amps != null && volts != null) {
      inputs.push(cInputs("cap_c_amps", `${countText(amps, 0)} A`), cInputs("cap_c_volts", `${countText(volts, 0)} V`));
    }
    clause = {
      rating: "Strong",
      reason: `Strong: ${cLabel} ${countText(availableMw)} MW, Verified`,
      inputs,
    };
  }

  const drpStrong = !clause
    && market === "LAS"
    && bKind === "drp"
    && bTrusted
    && (bConfidence === "Estimated" || bConfidence === "Verified")
    && frontage != null
    && frontage >= STRONG_MW;
  if (drpStrong && frontage != null) {
    clause = {
      rating: "Strong",
      reason: `Strong: NV Energy DRP frontage ${countText(frontage)} MW, ${bConfidence}`,
      inputs: [bInputs("cap_b_frontage", `${countText(frontage)} MW`)],
    };
  }

  if (!clause && cSourced && phase === "three" && electrical && amps != null && volts != null) {
    clause = {
      rating: "OK",
      reason: `OK: 3-phase service ${countText(amps, 0)} A at ${countText(volts, 0)} V, ${cConfidence}`,
      inputs: [
        cInputs("cap_c_amps", `${countText(amps, 0)} A`),
        cInputs("cap_c_volts", `${countText(volts, 0)} V`),
        cInputs("cap_c_phase", "3-phase"),
      ],
    };
  }

  if (!clause && bTrusted && frontage != null && frontage >= FRONTAGE_OK_MW) {
    clause = {
      rating: "OK",
      reason: `OK: frontage hosting ${countText(frontage)} MW, ${bConfidence}`,
      inputs: [bInputs("cap_b_frontage", `${countText(frontage)} MW`)],
    };
  }

  if (!clause && bTrusted && nearby != null && nearby >= STRONG_MW && (frontage == null || frontage < STRONG_MW)) {
    clause = {
      rating: "OK",
      reason: `OK: nearby hosting ${countText(nearby)} MW, ${bConfidence}`,
      inputs: [bInputs("cap_b_nearby", `${countText(nearby)} MW`)],
    };
  }

  if (!clause && bTrusted && frontage != null && nearby != null && frontage < WEAK_BELOW_MW && nearby < WEAK_BELOW_MW) {
    clause = {
      rating: "Weak",
      reason: `Weak: frontage ${countText(frontage)} MW and nearby ${countText(nearby)} MW, ${bConfidence}`,
      inputs: [
        bInputs("cap_b_frontage", `${countText(frontage)} MW`),
        bInputs("cap_b_nearby", `${countText(nearby)} MW`),
      ],
    };
  }

  const small = volts != null && volts <= 240 && amps != null && amps <= 200;
  if (!clause && cSourced && (phase === "single" || small) && amps != null && volts != null) {
    const kind = phase === "single" ? "single-phase" : "small service";
    clause = {
      rating: "Weak",
      reason: `Weak: ${kind} ${countText(amps, 0)} A at ${countText(volts, 0)} V, ${cConfidence}`,
      inputs: [
        cInputs("cap_c_amps", `${countText(amps, 0)} A`),
        cInputs("cap_c_volts", `${countText(volts, 0)} V`),
        cInputs("cap_c_phase", phase === "single" ? "single-phase" : phase === "three" ? "3-phase" : ""),
      ].filter((row) => row.value),
    };
  }

  if (!clause) {
    const partialC = text(input.cap_c_amps) || text(input.cap_c_volts) || text(input.cap_c_phase);
    const reason = partialC && !completeC
      ? "Unknown: incomplete Layer C service"
      : bTrusted && (frontage != null || nearby != null)
        ? "Unknown: hosting does not meet a rated band"
        : "Unknown: no Layer B hosting and no complete Layer C service";
    clause = { rating: "Unknown", reason, inputs: [] };
  }

  const capped = capMarket(market, clause);
  return { rating: capped.rating, reason: capped.reason, inputs: capped.inputs };
}
