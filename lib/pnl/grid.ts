import type { OpenPnlComment } from "@/lib/comments/anchor";
import type { DataConflict } from "@/lib/conflicts/view";
import { monthColumnState } from "./columns";
import { formatCapturedDate } from "./dateLabel";
import { LINE_LABELS, MONTH_SHORT, lineSection, sectionOrder, type PnlLineCode } from "./lines";
import { spanMonths } from "./period";
import { centsToRaw, formatAmount, parseAmount, percentOf, signedPercent } from "./money";
import type { PnlLineView, PnlPeriodView, PnlStatement, PnlYearView } from "./statement";
import { monthsInWindow, monthWindow } from "./window";

const ZERO = BigInt(0);

export type CellStatus = "reported" | "estimated" | "normalized" | "calculated";

export type ValueCell = {
  kind: "value";
  cents: bigint;
  amount: string;
  share: string | null;
  status: CellStatus;
  sourceDocument: string;
  sourcePage: string;
  sourceHref: string;
  capturedLabel: string;
  flag: string | null;
};

export type CellConflict = {
  status: DataConflict["status"];
  valueInUse: string;
  sources: DataConflict["sources"];
};

export type MissingCell = {
  kind: "missing";
  sourceDocument: string;
  sourcePage: string;
  capturedLabel: string;
  markerSource: string;
};

export type GridCell = (ValueCell | MissingCell | { kind: "blank" }) & {
  conflict?: CellConflict;
  commentOpen?: boolean;
};

export type GridRow = {
  id: string;
  label: string;
  kind: "group" | "line" | "total" | "margin";
  cells: GridCell[];
  commentOpen?: boolean;
};

export type GridColumn = {
  id: string;
  label: string;
  missing: boolean;
  statement?: boolean;
  periodStart?: string;
  periodEnd?: string;
  periodLabel?: string;
};

export type PnlGrid = { columns: GridColumn[]; rows: GridRow[]; years: number[]; note: string };

type Bucket = { missing: boolean; period: PnlPeriodView | null; missingSource?: MissingCell };

function allLines(period: PnlPeriodView | null): PnlLineView[] {
  if (!period) return [];
  return [...period.revenue, ...period.costs, ...period.results, ...period.addbacks];
}

function findCode(period: PnlPeriodView | null, code: PnlLineCode): PnlLineView | null {
  return allLines(period).find((line) => line.code === code) ?? null;
}

function lineCents(line: PnlLineView | null): bigint | null {
  if (!line) return null;
  return parseAmount(line.raw)?.cents ?? null;
}

function magnitude(cents: bigint): bigint {
  return cents < ZERO ? -cents : cents;
}

function fromLine(line: PnlLineView, cents: bigint, share: string | null, summed: boolean): ValueCell {
  return {
    kind: "value",
    cents,
    amount: summed ? formatAmount(centsToRaw(cents)) : line.amount,
    share,
    status: summed || line.sourceDocument === "Sum of captured months" ? "calculated" : line.status,
    sourceDocument: summed ? "Sum of captured months. Missing months are not filled in." : line.sourceDocument,
    sourcePage: summed ? "" : line.sourcePage,
    sourceHref: summed ? "" : line.sourceHref,
    capturedLabel: summed ? "" : formatCapturedDate(line.capturedAt),
    flag: summed ? null : line.flag?.reason ?? null,
  };
}

function fromMath(cents: bigint, share: string | null, note: string, display?: string): ValueCell {
  return {
    kind: "value",
    cents,
    amount: display || formatAmount(centsToRaw(cents)),
    share,
    status: "calculated",
    sourceDocument: note,
    sourcePage: "",
    sourceHref: "",
    capturedLabel: "",
    flag: null,
  };
}

function ofRevenue(part: bigint | null, revenue: bigint | null, signed = false): string | null {
  if (part == null || revenue == null) return null;
  const text = signed ? signedPercent(part, revenue) : percentOf(part, revenue);
  return text;
}

function revenueOf(period: PnlPeriodView | null): { cents: bigint; line: PnlLineView | null; summed: boolean } | null {
  if (!period) return null;
  const stated = findCode(period, "revenue");
  const statedCents = lineCents(stated);
  if (stated && statedCents != null) return { cents: statedCents, line: stated, summed: false };
  const details = period.revenue.filter((line) => line.code !== "revenue");
  if (!details.length) return null;
  return { cents: details.reduce((sum, line) => sum + (lineCents(line) ?? ZERO), ZERO), line: null, summed: true };
}

function spent(period: PnlPeriodView | null): bigint | null {
  if (!period?.costs.length) return null;
  return period.costs.reduce((sum, line) => sum + magnitude(lineCents(line) ?? ZERO), ZERO);
}

function added(period: PnlPeriodView | null): bigint | null {
  if (!period?.addbacks.length) return null;
  return period.addbacks.reduce((sum, line) => sum + magnitude(lineCents(line) ?? ZERO), ZERO);
}

function mergeMonths(periods: PnlPeriodView[], year: number): PnlPeriodView {
  const byCode = new Map<PnlLineCode, PnlLineView[]>();
  for (const period of periods) {
    for (const line of allLines(period)) {
      const list = byCode.get(line.code) || [];
      list.push(line);
      byCode.set(line.code, list);
    }
  }
  const combined: PnlLineView[] = [];
  for (const [code, group] of byCode) {
    const cents = group.reduce((sum, line) => sum + (lineCents(line) ?? ZERO), ZERO);
    const raw = centsToRaw(cents);
    combined.push({
      id: `sum-${year}-${code}`,
      code,
      label: LINE_LABELS[code],
      amount: formatAmount(raw),
      raw,
      status: "reported",
      share: null,
      sourceDocument: "Sum of captured months",
      sourcePage: "",
      sourceHref: "",
      capturedAt: "",
      flag: null,
      normalized: null,
    });
  }
  const grouped = { revenue: [] as PnlLineView[], costs: [] as PnlLineView[], results: [] as PnlLineView[], addbacks: [] as PnlLineView[] };
  for (const line of combined) grouped[lineSection(line.code)].push(line);
  return {
    id: `year-${year}`,
    grain: "annual",
    year,
    month: null,
    label: String(year),
    columnLabel: String(year),
    title: String(year),
    throughMonth: null,
    startMonth: null,
    periodStart: `${year}-01-01`,
    periodEnd: `${year}-12-31`,
    business: periods[0].business,
    businessLabel: periods[0].businessLabel,
    ...grouped,
    note: "Sum of captured months. Missing months are not filled in.",
  };
}

function emptyCell(bucket: Bucket): GridCell | null {
  if (bucket.missing) {
    return bucket.missingSource ?? { kind: "missing", sourceDocument: "", sourcePage: "", capturedLabel: "", markerSource: "" };
  }
  if (!bucket.period) return { kind: "blank" };
  return null;
}

function missingBucket(year: PnlYearView | undefined, month: number): Bucket {
  const detail = year?.missingDetails?.find((item) => item.month === month);
  return {
    missing: true,
    period: null,
    missingSource: {
      kind: "missing",
      sourceDocument: detail?.sourceDocument || "",
      sourcePage: detail?.sourcePage || "",
      capturedLabel: detail?.capturedAt ? formatCapturedDate(detail.capturedAt) : "",
      markerSource: detail?.markerSource || "",
    },
  };
}

function partialTotal(year: PnlYearView): PnlPeriodView | null {
  const window = monthWindow(year);
  const present = window ? monthsInWindow(year, window) : year.months.filter((period): period is PnlPeriodView => Boolean(period));
  if (present.length) return mergeMonths(present, year.year);
  return year.ranges?.[0] ?? null;
}

function monthBuckets(statement: PnlStatement, year: number): Bucket[] {
  const row = statement.years.find((item) => item.year === year);
  const months = row?.months ?? Array.from({ length: 12 }, () => null);
  const buckets: Bucket[] = months.map((period, index) => {
    const state = row ? monthColumnState(row, index) : period ? "present" : "blank";
    if (state === "missing") return missingBucket(row, index + 1);
    return { missing: false, period };
  });
  if (row?.annual) buckets.push({ missing: false, period: row.annual });
  else {
    const total = row ? partialTotal(row) : null;
    buckets.push({ missing: false, period: total });
  }
  return buckets;
}

function withPeriod(column: GridColumn, period: PnlPeriodView | null | undefined): GridColumn {
  if (!period?.periodStart || !period.periodEnd) return column;
  return {
    ...column,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    periodLabel: period.label,
  };
}

export function columnPeriodKey(column: GridColumn): string {
  return column.periodLabel || column.label;
}

function periodKeys(column: GridColumn): string[] {
  const keys = [column.label, column.periodLabel || ""];
  if (column.periodStart && column.periodEnd) {
    keys.push(`${column.periodStart}/${column.periodEnd}`);
    if (column.periodStart.endsWith("-01-01") && column.periodEnd.endsWith("-12-31")) {
      keys.push(column.periodStart.slice(0, 4));
      keys.push(`FY${column.periodStart.slice(0, 4)}`);
    }
  }
  return keys.filter((key): key is string => Boolean(key));
}

function attachConflicts(grid: PnlGrid, conflicts: DataConflict[]): PnlGrid {
  const marks = conflicts.filter((row) => row.subject === "pnl_line");
  if (!marks.length) return grid;
  return {
    ...grid,
    rows: grid.rows.map((row) => ({
      ...row,
      cells: row.cells.map((cell, index) => {
        const column = grid.columns[index];
        if (!column) return cell;
        const keys = periodKeys(column);
        const hit = marks.find((mark) => mark.field === row.id && keys.includes(mark.period));
        if (!hit) return cell;
        return {
          ...cell,
          conflict: { status: hit.status, valueInUse: hit.valueInUse, sources: hit.sources },
        };
      }),
    })),
  };
}

function annualLayout(statement: PnlStatement): { column: GridColumn; bucket: Bucket }[] {
  const layout: { column: GridColumn; bucket: Bucket }[] = [];
  for (const year of statement.years) {
    const periods = [year.annual, ...(year.ranges ?? [])].filter((period): period is PnlPeriodView => Boolean(period));
    if (!periods.length) {
      const total = partialTotal(year);
      layout.push(total
        ? {
            column: withPeriod(
              { id: `year-${year.year}`, label: year.columnLabel || String(year.year), missing: false, statement: false },
              total,
            ),
            bucket: { missing: false, period: total },
          }
        : {
            column: { id: `year-${year.year}`, label: year.columnLabel || String(year.year), missing: true, statement: false },
            bucket: missingBucket(year, 0),
          });
      continue;
    }
    for (const period of periods) {
      const shown = period === year.annual ? period : (partialTotal(year) ?? period);
      layout.push({
        column: withPeriod({
          id: period.id,
          label: period.columnLabel,
          missing: false,
          statement: spanMonths(period.periodStart, period.periodEnd) === 12,
        }, period),
        bucket: { missing: false, period: shown },
      });
    }
  }
  return layout;
}

function usedCodes(buckets: Bucket[], section: "revenue" | "costs" | "addbacks"): PnlLineCode[] {
  const found = new Set<PnlLineCode>();
  for (const bucket of buckets) {
    for (const line of allLines(bucket.period)) {
      if (lineSection(line.code) !== section) continue;
      if (section === "revenue" && line.code === "revenue") continue;
      found.add(line.code);
    }
  }
  return sectionOrder(section).filter((code) => found.has(code));
}

function attachComments(grid: PnlGrid, comments: OpenPnlComment[]): PnlGrid {
  if (!comments.length) return grid;
  return {
    ...grid,
    rows: grid.rows.map((row) => {
      const lineOpen = comments.some((mark) => mark.type === "pnl_line" && mark.line === row.id);
      return {
        ...row,
        ...(lineOpen ? { commentOpen: true } : {}),
        cells: row.cells.map((cell, index) => {
          const column = grid.columns[index];
          if (!column) return cell;
          const keys = periodKeys(column);
          const open = comments.some((mark) => mark.type === "pnl_cell" && mark.line === row.id && keys.includes(mark.period));
          return open ? { ...cell, commentOpen: true } : cell;
        }),
      };
    }),
  };
}

export function buildPnlGrid(statement: PnlStatement, mode: "months" | "years", year?: number, conflicts: DataConflict[] = [], comments: OpenPnlComment[] = []): PnlGrid {
  const years = statement.years.map((item) => item.year);
  if (statement.status !== "ready" || !years.length) return { columns: [], rows: [], years, note: "" };
  const selected = year && years.includes(year) ? year : years[0];
  const yearLayout = mode === "years" ? annualLayout(statement) : [];
  const buckets = mode === "years" ? yearLayout.map((item) => item.bucket) : monthBuckets(statement, selected);
  const selectedYear = statement.years.find((item) => item.year === selected);
  const capturedMonths = selectedYear?.months.filter(Boolean).length ?? 0;
  const annualIsStatement = Boolean(selectedYear?.annual);
  const columns: GridColumn[] = mode === "years"
    ? yearLayout.map((item) => item.column)
    : [
        ...MONTH_SHORT.map((label, index) => withPeriod({
          id: label.toLowerCase(),
          label,
          missing: selectedYear ? monthColumnState(selectedYear, index) === "missing" : false,
        }, buckets[index]?.period)),
        withPeriod({
          id: "ytd",
          label: annualIsStatement ? `FY${selected} (statement)` : "YTD",
          missing: false,
          statement: annualIsStatement,
        }, buckets[12]?.period),
      ];
  const hatched = "Hatched = month not in package.";
  const note = mode === "months" && annualIsStatement
    ? `${hatched} ${capturedMonths} of 12 months captured; annual from statement.`
    : mode === "months"
      ? `${hatched} YTD is the sum of captured months.`
      : hatched;

  const contexts = buckets.map((bucket) => {
    const revenue = bucket.missing ? null : revenueOf(bucket.period);
    const costs = bucket.missing ? null : spent(bucket.period);
    return { bucket, revenue: revenue?.cents ?? null, costs };
  });

  function cellFor(code: PnlLineCode, bucket: Bucket, revenue: bigint | null): GridCell {
    const gap = emptyCell(bucket);
    if (gap) return gap;
    const line = findCode(bucket.period, code);
    const cents = lineCents(line);
    if (!line || cents == null) return { kind: "blank" };
    const summed = line.sourceDocument === "Sum of captured months";
    return fromLine(line, summed ? cents : cents, ofRevenue(magnitude(cents), revenue), summed);
  }

  function revenueCell(bucket: Bucket): GridCell {
    const gap = emptyCell(bucket);
    if (gap) return gap;
    const revenue = revenueOf(bucket.period);
    if (!revenue) return { kind: "blank" };
    if (revenue.line && !revenue.summed) return fromLine(revenue.line, revenue.cents, ofRevenue(revenue.cents, revenue.cents), false);
    return fromMath(revenue.cents, ofRevenue(revenue.cents, revenue.cents), "Sum of captured revenue lines. No stated total was on this period.");
  }

  function costCell(bucket: Bucket, costs: bigint | null, revenue: bigint | null): GridCell {
    const gap = emptyCell(bucket);
    if (gap) return gap;
    if (costs == null) return { kind: "blank" };
    return fromMath(costs, ofRevenue(costs, revenue), "Sum of captured cost lines.");
  }

  const rows: GridRow[] = [{ id: "group-revenue", label: "Revenue", kind: "group", cells: [] }];
  for (const code of usedCodes(buckets, "revenue")) {
    rows.push({
      id: code,
      label: LINE_LABELS[code],
      kind: "line",
      cells: contexts.map(({ bucket, revenue }) => cellFor(code, bucket, revenue)),
    });
  }
  const revenueCells = contexts.map(({ bucket }) => revenueCell(bucket));
  rows.push({ id: "total-revenue", label: "Total revenue", kind: "total", cells: revenueCells });
  rows.push({ id: "group-costs", label: "Costs", kind: "group", cells: [] });
  for (const code of usedCodes(buckets, "costs")) {
    rows.push({
      id: code,
      label: LINE_LABELS[code],
      kind: "line",
      cells: contexts.map(({ bucket, revenue }) => cellFor(code, bucket, revenue)),
    });
  }
  rows.push({
    id: "total-costs",
    label: "Total costs",
    kind: "total",
    cells: contexts.map(({ bucket, revenue, costs }) => costCell(bucket, costs, revenue)),
  });

  const ebitdaCells: GridCell[] = contexts.map(({ bucket, revenue, costs }) => {
    const gap = emptyCell(bucket);
    if (gap) return gap;
    const stated = findCode(bucket.period, "ebitda");
    const statedCents = lineCents(stated);
    if (stated && statedCents != null) return fromLine(stated, statedCents, ofRevenue(statedCents, revenue, true), stated.sourceDocument === "Sum of captured months");
    if (revenue == null || costs == null) return { kind: "blank" };
    return fromMath(revenue - costs, ofRevenue(revenue - costs, revenue, true), "Revenue minus captured costs. The package did not state EBITDA.");
  });
  rows.push({ id: "ebitda", label: "EBITDA", kind: "total", cells: ebitdaCells });
  rows.push({
    id: "margin",
    label: "EBITDA margin",
    kind: "margin",
    cells: ebitdaCells.map((cell) => {
      if (cell.kind === "missing") return cell;
      if (cell.kind !== "value" || !cell.share) return { kind: "blank" };
      return fromMath(cell.cents, cell.share, "EBITDA divided by revenue for this column.", cell.share);
    }),
  });
  if (buckets.some((bucket) => findCode(bucket.period, "noi"))) {
    rows.push({
      id: "noi",
      label: "NOI",
      kind: "line",
      cells: contexts.map(({ bucket, revenue }) => cellFor("noi", bucket, revenue)),
    });
  }
  if (buckets.some((bucket) => (bucket.period?.addbacks.length || 0) > 0)) {
    rows.push({ id: "group-addbacks", label: "Owner add-backs", kind: "group", cells: [] });
    for (const code of usedCodes(buckets, "addbacks")) {
      rows.push({
        id: code,
        label: LINE_LABELS[code],
        kind: "line",
        cells: contexts.map(({ bucket, revenue }) => cellFor(code, bucket, revenue)),
      });
    }
    const sdeCells = contexts.map(({ bucket, revenue }, index) => {
      const gap = emptyCell(bucket);
      if (gap) return gap;
      const extra = added(bucket.period);
      const base = ebitdaCells[index];
      if (extra == null || base.kind !== "value") return { kind: "blank" } as GridCell;
      const cents = base.cents + extra;
      return fromMath(cents, ofRevenue(cents, revenue, true), "EBITDA plus captured owner add-backs.");
    });
    rows.push({ id: "sde", label: "SDE", kind: "total", cells: sdeCells });
    rows.push({
      id: "sde-margin",
      label: "SDE margin",
      kind: "margin",
      cells: sdeCells.map((cell) => (cell.kind === "value" && cell.share ? fromMath(cell.cents, cell.share, "SDE divided by revenue for this column.", cell.share) : cell.kind === "missing" ? cell : { kind: "blank" })),
    });
  }
  return attachComments(attachConflicts({ columns, rows, years, note }, conflicts), comments);
}

export function columnSummary(grid: PnlGrid, index: number): { revenue: string; costs: string; ebitda: string; margin: string } {
  const show = (id: string) => {
    const cell = grid.rows.find((row) => row.id === id)?.cells[index];
    if (!cell || cell.kind === "missing") return "Missing";
    if (cell.kind === "blank") return "—";
    return id === "margin" ? cell.share || cell.amount : cell.amount;
  };
  return { revenue: show("total-revenue"), costs: show("total-costs"), ebitda: show("ebitda"), margin: show("margin") };
}
