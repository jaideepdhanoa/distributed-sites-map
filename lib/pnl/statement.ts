import { flagLine, type LineFlag } from "./benchmarks";
import {
  BUSINESS_LABELS,
  LINE_LABELS,
  MONTH_NAMES,
  lineSection,
  sectionOrder,
  type PnlBusiness,
  type PnlLineCode,
  type PnlSection,
} from "./lines";
import { formatAmount, percentOf, type CapturedAmount } from "./money";
import { coverageOf, periodLabels, spanMonths } from "./period";

export type PnlStatus = "reported" | "estimated" | "normalized";

export type CapturedLine = {
  id: string;
  periodId: string;
  grain: "annual" | "monthly";
  year: number;
  month: number | null;
  throughMonth: number | null;
  startMonth?: number | null;
  periodStart?: string;
  periodEnd?: string;
  business: PnlBusiness;
  code: PnlLineCode;
  amount: CapturedAmount;
  status: PnlStatus;
  sourceDocument: string;
  sourcePage: string;
  sourceHref: string;
  capturedAt: string;
};

export type MissingMonth = {
  year: number;
  month: number;
  business: PnlBusiness;
  periodId: string;
  sourceDocument?: string;
  sourcePage?: string;
  capturedAt?: string;
  /** Change-level source, such as "Not in package". It is not the line's document. */
  markerSource?: string;
};

export type MissingDetail = {
  month: number;
  sourceDocument: string;
  sourcePage: string;
  capturedAt: string;
  markerSource: string;
};

export type NormalizedMark = {
  id: string;
  amount: string;
  raw: string;
};

export type PnlLineView = {
  id: string;
  code: PnlLineCode;
  label: string;
  amount: string;
  raw: string;
  status: PnlStatus;
  share: string | null;
  sourceDocument: string;
  sourcePage: string;
  sourceHref: string;
  capturedAt: string;
  flag: LineFlag | null;
  /** Present when a normalized line is stored beside this stated line. */
  normalized: NormalizedMark | null;
};

export type PnlPeriodView = {
  id: string;
  grain: "annual" | "monthly";
  year: number;
  month: number | null;
  label: string;
  columnLabel: string;
  title: string;
  throughMonth: number | null;
  startMonth: number | null;
  periodStart: string;
  periodEnd: string;
  business: PnlBusiness;
  businessLabel: string;
  revenue: PnlLineView[];
  costs: PnlLineView[];
  results: PnlLineView[];
  addbacks: PnlLineView[];
  note: string;
};

export type PnlYearView = {
  year: number;
  columnLabel: string;
  annual: PnlPeriodView | null;
  /** Partial years, and a fiscal year when a calendar year is already the annual column. */
  ranges: PnlPeriodView[];
  months: Array<PnlPeriodView | null>;
  /** Months the package should have included and did not. Other empty months stay blank. */
  missingMonths: number[];
  missingDetails: MissingDetail[];
  coverage: string;
  flagCount: number;
  businessLabel: string;
};

export type PnlStatement = {
  status: "empty" | "ready" | "unavailable";
  message: string;
  years: PnlYearView[];
  normalizedYears: PnlYearView[];
  hasNormalized: boolean;
};

export function emptyStatement(): PnlStatement {
  return { status: "empty", message: "No P&L captured yet. A broker package still needs to be broken into line items.", years: [], normalizedYears: [], hasNormalized: false };
}

export function unavailableStatement(): PnlStatement {
  return { status: "unavailable", message: "Profit and loss is not on this database yet.", years: [], normalizedYears: [], hasNormalized: false };
}

function coverage(months: Array<PnlPeriodView | null>, missingMonths: number[], throughMonth: number | null): string {
  const present = months.flatMap((period, index) => (period ? [MONTH_NAMES[index]] : []));
  const missing = missingMonths.map((month) => MONTH_NAMES[month - 1]);
  if (!present.length) {
    if (missing.length) return `Missing: ${missing.join(", ")}.`;
    return throughMonth
      ? `No monthly statements. The annual statement runs through ${MONTH_NAMES[throughMonth - 1]}.`
      : "No monthly statements captured.";
  }
  const onFile = `On file: ${present.join(", ")}.`;
  if (missing.length) return `${onFile} Missing: ${missing.join(", ")}.`;
  if (!months.some((period) => !period)) return `${onFile} All twelve months are on file.`;
  return onFile;
}

function viewLine(line: CapturedLine, revenue: CapturedLine | null, normalized: CapturedLine | null): PnlLineView {
  const revenueCents = revenue && revenue.code === "revenue" ? revenue.amount.cents : null;
  const share = revenueCents == null ? null : percentOf(line.amount.cents, revenueCents);
  const basis = revenue?.status === "normalized" ? "normalized revenue" : "stated revenue";
  const shareLabel = share == null
    ? null
    : revenue?.status === "estimated"
      ? `${share} of stated revenue (estimated)`
      : `${share} of ${basis}`;
  return {
    id: line.id,
    code: line.code,
    label: LINE_LABELS[line.code],
    amount: formatAmount(line.amount.raw),
    raw: line.amount.raw,
    status: line.status,
    share: line.code === "revenue" ? null : shareLabel,
    sourceDocument: line.sourceDocument,
    sourcePage: line.sourcePage,
    sourceHref: line.sourceHref,
    capturedAt: line.capturedAt,
    normalized: normalized
      ? { id: normalized.id, amount: formatAmount(normalized.amount.raw), raw: normalized.amount.raw }
      : null,
    flag: flagLine({
      code: line.code,
      cents: line.amount.cents,
      business: line.business,
      revenueCents,
      revenueStatus: revenue?.status ?? null,
      status: line.status,
    }),
  };
}

function periodNote(lines: CapturedLine[]): string {
  const revenue = lines.find((line) => line.code === "revenue");
  if (!revenue) return "No stated revenue total, so the bands were not checked.";
  if (revenue.amount.cents === BigInt(0)) return "Stated revenue is zero, so the bands were not checked.";
  if (revenue.amount.cents < BigInt(0)) return "Stated revenue is negative, so the bands were not checked.";
  return "";
}

function lineCoverage(line: CapturedLine) {
  if (line.periodStart && line.periodEnd) {
    return {
      periodStart: line.periodStart,
      periodEnd: line.periodEnd,
      startMonth: line.startMonth ?? null,
      throughMonth: line.throughMonth,
    };
  }
  return coverageOf({
    grain: line.grain,
    year: line.year,
    month: line.month,
    startMonth: line.startMonth,
    throughMonth: line.throughMonth,
  });
}

function buildPeriod(lines: CapturedLine[], normalizedIndex: Map<string, CapturedLine> | null): PnlPeriodView {
  const first = lines[0];
  const bounds = lineCoverage(first);
  const labels = periodLabels({
    grain: first.grain,
    year: first.year,
    month: first.month,
    startMonth: bounds.startMonth,
    throughMonth: bounds.throughMonth,
    periodStart: bounds.periodStart,
    periodEnd: bounds.periodEnd,
  });
  const revenueLine = lines.find((line) => line.code === "revenue") ?? null;
  const grouped: Record<PnlSection, PnlLineView[]> = { revenue: [], costs: [], results: [], addbacks: [] };
  const sectionRank: Record<PnlSection, number> = { revenue: 0, costs: 1, results: 2, addbacks: 3 };
  const ordered = [...lines].sort((a, b) => {
    const sectionA = lineSection(a.code);
    const sectionB = lineSection(b.code);
    if (sectionA !== sectionB) return sectionRank[sectionA] - sectionRank[sectionB];
    return sectionOrder(sectionA).indexOf(a.code) - sectionOrder(sectionB).indexOf(b.code);
  });
  for (const line of ordered) {
    const normalized = normalizedIndex?.get(`${line.periodId}:${line.code}`) ?? null;
    grouped[lineSection(line.code)].push(viewLine(line, revenueLine, normalized));
  }
  return {
    id: first.periodId,
    grain: first.grain,
    year: first.year,
    month: first.month,
    label: labels.label,
    columnLabel: labels.columnLabel,
    title: labels.title,
    throughMonth: bounds.throughMonth,
    startMonth: bounds.startMonth,
    periodStart: bounds.periodStart,
    periodEnd: bounds.periodEnd,
    business: first.business,
    businessLabel: BUSINESS_LABELS[first.business],
    revenue: grouped.revenue,
    costs: grouped.costs,
    results: grouped.results,
    addbacks: grouped.addbacks,
    note: periodNote(lines),
  };
}

function countFlags(periods: Array<PnlPeriodView | null>): number {
  let count = 0;
  for (const period of periods) {
    if (!period) continue;
    for (const line of [...period.revenue, ...period.costs, ...period.results, ...period.addbacks]) {
      if (line.flag) count += 1;
    }
  }
  return count;
}

function isFullYear(period: PnlPeriodView): boolean {
  return spanMonths(period.periodStart, period.periodEnd) === 12;
}

function buildYears(lines: CapturedLine[], missing: MissingMonth[], normalizedIndex: Map<string, CapturedLine> | null): PnlYearView[] {
  const byPeriod = new Map<string, CapturedLine[]>();
  for (const line of lines) {
    const bucket = byPeriod.get(line.periodId) || [];
    bucket.push(line);
    byPeriod.set(line.periodId, bucket);
  }
  const periods = [...byPeriod.values()].map((group) => buildPeriod(group, normalizedIndex));
  const years = [...new Set([
    ...periods.map((period) => period.year),
    ...missing.map((month) => month.year),
  ])].sort((a, b) => b - a);
  return years.map((year) => {
    const annuals = periods.filter((period) => period.year === year && period.grain === "annual");
    const full = annuals.filter(isFullYear);
    const annual = full.find((period) => (period.startMonth ?? 1) === 1) ?? full[0] ?? null;
    const ranges = annuals.filter((period) => period !== annual);
    const months = Array.from({ length: 12 }, (_, index) => (
      periods.find((period) => period.year === year && period.grain === "monthly" && period.month === index + 1) ?? null
    ));
    const missingRows = missing.filter((month) => month.year === year && month.month >= 1 && month.month <= 12 && !months[month.month - 1]);
    const missingMonths = [...new Set(missingRows.map((month) => month.month))].sort((a, b) => a - b);
    const missingDetails = missingMonths.map((month) => {
      const row = missingRows.find((item) => item.month === month);
      return {
        month,
        sourceDocument: row?.sourceDocument || "",
        sourcePage: row?.sourcePage || "",
        capturedAt: row?.capturedAt || "",
        markerSource: row?.markerSource || "",
      };
    });
    const businessLabel = annual?.businessLabel || ranges[0]?.businessLabel || months.find((period) => period)?.businessLabel || "";
    return {
      year,
      columnLabel: annual?.columnLabel || String(year),
      annual,
      ranges,
      months,
      missingMonths,
      missingDetails,
      coverage: coverage(months, missingMonths, annual?.throughMonth ?? ranges[0]?.throughMonth ?? null),
      flagCount: countFlags([annual, ...ranges, ...months]),
      businessLabel,
    };
  });
}

/** Group captured lines into years. Stated lines are the default. Normalized lines sit beside them. */
export function buildStatement(lines: CapturedLine[], missing: MissingMonth[] = []): PnlStatement {
  const stated = lines.filter((line) => line.status !== "normalized");
  const normalized = lines.filter((line) => line.status === "normalized");
  if (!stated.length && !normalized.length && !missing.length) return emptyStatement();
  const normalizedIndex = new Map(normalized.map((line) => [`${line.periodId}:${line.code}`, line]));
  const years = buildYears(stated, missing, normalizedIndex);
  const normalizedYears = buildYears(normalized, missing, null);
  return {
    status: "ready",
    message: "",
    years,
    normalizedYears,
    hasNormalized: normalized.length > 0,
  };
}

export function statedRevenue(period: PnlPeriodView | null): PnlLineView | null {
  return period?.revenue.find((line) => line.code === "revenue") ?? null;
}

export function statusLabel(status: PnlStatus): string {
  if (status === "estimated") return "Estimated";
  if (status === "normalized") return "Normalized";
  return "Stated";
}
