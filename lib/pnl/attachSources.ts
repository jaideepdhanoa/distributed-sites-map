import { formatCapturedDate } from "@/lib/pnl/dateLabel";
import { resolveFileNames, type DriveLister } from "@/lib/pnl/driveFiles";
import {
  bareFileId,
  driveFileIdFromHref,
  fileNameOf,
  gmailLinkFor,
  normalizeFileName,
  sourceView,
} from "@/lib/pnl/sourceLink";
import type { MissingDetail, PnlLineView, PnlPeriodView, PnlStatement, PnlYearView } from "@/lib/pnl/statement";

export type SourceLinkOptions = {
  folderId: string;
  gmailAllowed: boolean;
  lister: DriveLister | null;
};

function needsLookup(line: { sourceDocument: string; sourceHref?: string }): string {
  if (driveFileIdFromHref(line.sourceHref || "") || bareFileId(line.sourceDocument)) return "";
  return fileNameOf(line.sourceDocument);
}

function presentLine(line: PnlLineView, found: Map<string, { id: string; mime: string } | null>, gmailAllowed: boolean): PnlLineView {
  const filename = needsLookup(line);
  const resolved = filename ? found.get(normalizeFileName(filename)) : null;
  const view = sourceView({
    document: line.sourceDocument,
    page: line.sourcePage,
    href: line.sourceHref,
    capturedLabel: formatCapturedDate(line.capturedAt),
    fileId: resolved?.id || "",
    mime: resolved?.mime || "",
    gmailHref: gmailLinkFor(line.sourceDocument, line.sourceHref, line.sourcePage, gmailAllowed && !resolved?.id && !driveFileIdFromHref(line.sourceHref)),
  });
  return {
    ...line,
    sourceDocument: view.label,
    sourceHref: view.href,
    gmailHref: view.gmailHref,
  };
}

function presentMissing(detail: MissingDetail, found: Map<string, { id: string; mime: string } | null>, gmailAllowed: boolean): MissingDetail {
  const filename = needsLookup(detail);
  const resolved = filename ? found.get(normalizeFileName(filename)) : null;
  const view = sourceView({
    document: detail.sourceDocument,
    page: detail.sourcePage,
    href: detail.sourceHref || "",
    capturedLabel: formatCapturedDate(detail.capturedAt),
    fileId: resolved?.id || "",
    mime: resolved?.mime || "",
    gmailHref: gmailLinkFor(detail.sourceDocument, detail.sourceHref || "", detail.sourcePage, gmailAllowed && !resolved?.id && !driveFileIdFromHref(detail.sourceHref || "")),
  });
  return {
    ...detail,
    sourceDocument: view.label,
    sourceHref: view.href,
    gmailHref: view.gmailHref,
  };
}

function mapPeriod(period: PnlPeriodView | null, found: Map<string, { id: string; mime: string } | null>, gmailAllowed: boolean): PnlPeriodView | null {
  if (!period) return null;
  const map = (lines: PnlLineView[]) => lines.map((line) => presentLine(line, found, gmailAllowed));
  return {
    ...period,
    revenue: map(period.revenue),
    costs: map(period.costs),
    results: map(period.results),
    addbacks: map(period.addbacks),
  };
}

function mapYear(year: PnlYearView, found: Map<string, { id: string; mime: string } | null>, gmailAllowed: boolean): PnlYearView {
  return {
    ...year,
    annual: mapPeriod(year.annual, found, gmailAllowed),
    ranges: year.ranges.map((period) => mapPeriod(period, found, gmailAllowed)).filter((period): period is PnlPeriodView => Boolean(period)),
    months: year.months.map((period) => mapPeriod(period, found, gmailAllowed)),
    missingDetails: year.missingDetails.map((detail) => presentMissing(detail, found, gmailAllowed)),
  };
}

function collect(statement: PnlStatement): string[] {
  const names: string[] = [];
  const takeLine = (line: PnlLineView) => {
    const name = needsLookup(line);
    if (name) names.push(name);
  };
  const takePeriod = (period: PnlPeriodView | null) => {
    if (!period) return;
    for (const line of [...period.revenue, ...period.costs, ...period.results, ...period.addbacks]) takeLine(line);
  };
  for (const year of [...statement.years, ...statement.normalizedYears]) {
    takePeriod(year.annual);
    for (const period of year.ranges) takePeriod(period);
    for (const period of year.months) takePeriod(period);
    for (const detail of year.missingDetails) {
      if (needsLookup(detail)) names.push(needsLookup(detail));
    }
  }
  return names;
}

/** Fill Drive file links and strip Gmail ids before the statement is sent. */
export async function attachPnlSourceLinks(statement: PnlStatement, options: SourceLinkOptions): Promise<PnlStatement> {
  if (statement.status !== "ready") return statement;
  const names = collect(statement);
  const found = names.length
    ? await resolveFileNames(options.folderId, names, options.lister)
    : new Map<string, { id: string; mime: string } | null>();
  return {
    ...statement,
    years: statement.years.map((year) => mapYear(year, found, options.gmailAllowed)),
    normalizedYears: statement.normalizedYears.map((year) => mapYear(year, found, options.gmailAllowed)),
  };
}
