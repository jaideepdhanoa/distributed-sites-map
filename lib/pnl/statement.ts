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

export type PnlStatus = "reported" | "estimated";

export type CapturedLine = {
  id: string;
  periodId: string;
  grain: "annual" | "monthly";
  year: number;
  month: number | null;
  throughMonth: number | null;
  business: PnlBusiness;
  code: PnlLineCode;
  amount: CapturedAmount;
  status: PnlStatus;
  sourceDocument: string;
  sourcePage: string;
  sourceHref: string;
  capturedAt: string;
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
};

export type PnlPeriodView = {
  id: string;
  grain: "annual" | "monthly";
  year: number;
  month: number | null;
  label: string;
  throughMonth: number | null;
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
  annual: PnlPeriodView | null;
  months: Array<PnlPeriodView | null>;
  coverage: string;
  flagCount: number;
  businessLabel: string;
};

export type PnlStatement = {
  status: "empty" | "ready" | "unavailable";
  message: string;
  years: PnlYearView[];
};

export function emptyStatement(): PnlStatement {
  return { status: "empty", message: "No financial package has been captured yet.", years: [] };
}

export function unavailableStatement(): PnlStatement {
  return { status: "unavailable", message: "Profit and loss is not on this database yet.", years: [] };
}

function periodLabel(grain: "annual" | "monthly", year: number, month: number | null, throughMonth: number | null): string {
  if (grain === "monthly" && month) return `${MONTH_NAMES[month - 1]} ${year}`;
  if (throughMonth) return `${year} through ${MONTH_NAMES[throughMonth - 1]}`;
  return String(year);
}

function coverage(months: Array<PnlPeriodView | null>, throughMonth: number | null): string {
  const present = months.flatMap((period, index) => (period ? [MONTH_NAMES[index]] : []));
  if (!present.length) {
    return throughMonth
      ? `No monthly statements. The annual statement runs through ${MONTH_NAMES[throughMonth - 1]}.`
      : "No monthly statements captured.";
  }
  const missing = months.flatMap((period, index) => (period ? [] : [MONTH_NAMES[index]]));
  const onFile = `On file: ${present.join(", ")}.`;
  if (!missing.length) return `${onFile} All twelve months are on file.`;
  return `${onFile} Missing: ${missing.join(", ")}.`;
}

function viewLine(line: CapturedLine, revenue: CapturedLine | null): PnlLineView {
  const revenueCents = revenue && revenue.code === "revenue" ? revenue.amount.cents : null;
  const share = revenueCents == null ? null : percentOf(line.amount.cents, revenueCents);
  const shareLabel = share == null
    ? null
    : revenue?.status === "estimated"
      ? `${share} of stated revenue (estimated)`
      : `${share} of stated revenue`;
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

function buildPeriod(lines: CapturedLine[]): PnlPeriodView {
  const first = lines[0];
  const revenueLine = lines.find((line) => line.code === "revenue") ?? null;
  const grouped: Record<PnlSection, PnlLineView[]> = { revenue: [], costs: [], results: [], addbacks: [] };
  const sectionRank: Record<PnlSection, number> = { revenue: 0, costs: 1, results: 2, addbacks: 3 };
  const ordered = [...lines].sort((a, b) => {
    const sectionA = lineSection(a.code);
    const sectionB = lineSection(b.code);
    if (sectionA !== sectionB) return sectionRank[sectionA] - sectionRank[sectionB];
    return sectionOrder(sectionA).indexOf(a.code) - sectionOrder(sectionB).indexOf(b.code);
  });
  for (const line of ordered) grouped[lineSection(line.code)].push(viewLine(line, revenueLine));
  return {
    id: first.periodId,
    grain: first.grain,
    year: first.year,
    month: first.month,
    label: periodLabel(first.grain, first.year, first.month, first.throughMonth),
    throughMonth: first.throughMonth,
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

/** Group captured lines into years. Months that were not captured stay empty. Totals are not summed. */
export function buildStatement(lines: CapturedLine[]): PnlStatement {
  if (!lines.length) return emptyStatement();
  const byPeriod = new Map<string, CapturedLine[]>();
  for (const line of lines) {
    const bucket = byPeriod.get(line.periodId) || [];
    bucket.push(line);
    byPeriod.set(line.periodId, bucket);
  }
  const periods = [...byPeriod.values()].map(buildPeriod);
  const years = [...new Set(periods.map((period) => period.year))].sort((a, b) => b - a);
  const views: PnlYearView[] = years.map((year) => {
    const annual = periods.find((period) => period.year === year && period.grain === "annual") ?? null;
    const months = Array.from({ length: 12 }, (_, index) => (
      periods.find((period) => period.year === year && period.grain === "monthly" && period.month === index + 1) ?? null
    ));
    const businessLabel = annual?.businessLabel || months.find((period) => period)?.businessLabel || "";
    return {
      year,
      annual,
      months,
      coverage: coverage(months, annual?.throughMonth ?? null),
      flagCount: countFlags([annual, ...months]),
      businessLabel,
    };
  });
  return { status: "ready", message: "", years: views };
}

export function statedRevenue(period: PnlPeriodView | null): PnlLineView | null {
  return period?.revenue.find((line) => line.code === "revenue") ?? null;
}
