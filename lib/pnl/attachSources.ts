import { formatCapturedDate } from "@/lib/pnl/dateLabel";
import { resolveFileNames, type DriveLister } from "@/lib/pnl/driveFiles";
import {
  bareFileId,
  driveFileIdFromHref,
  fileNameOf,
  gmailLinkFor,
  lookupNames,
  normalizeFileName,
  packageParts,
  sourceView,
  type SourceLinkPart,
} from "@/lib/pnl/sourceLink";
import type { MissingDetail, PnlLineView, PnlPeriodView, PnlStatement, PnlYearView } from "@/lib/pnl/statement";

export type SourceLinkOptions = {
  folderId: string;
  gmailAllowed: boolean;
  lister: DriveLister | null;
};

function hit(found: Map<string, { id: string; mime: string } | null>, name: string): { id: string; mime: string } | null {
  return name ? found.get(normalizeFileName(name)) || null : null;
}

function chosenFile(
  document: string,
  href: string,
  found: Map<string, { id: string; mime: string } | null>,
): { fileId: string; mime: string; linkPart: SourceLinkPart } {
  const stored = driveFileIdFromHref(href) || bareFileId(document);
  const parts = packageParts(document);
  if (stored) return { fileId: stored, mime: "", linkPart: parts ? "zip" : "" };
  if (parts) {
    const zip = hit(found, parts.zip);
    if (zip?.id) return { fileId: zip.id, mime: zip.mime, linkPart: "zip" };
    const memberName = fileNameOf(parts.member);
    const member = hit(found, memberName);
    if (member?.id) return { fileId: member.id, mime: member.mime, linkPart: "member" };
    return { fileId: "", mime: "", linkPart: "" };
  }
  const single = hit(found, fileNameOf(document));
  if (single?.id) return { fileId: single.id, mime: single.mime, linkPart: "" };
  return { fileId: "", mime: "", linkPart: "" };
}

function presentLine(line: PnlLineView, found: Map<string, { id: string; mime: string } | null>, gmailAllowed: boolean): PnlLineView {
  const chosen = chosenFile(line.sourceDocument, line.sourceHref, found);
  const view = sourceView({
    document: line.sourceDocument,
    page: line.sourcePage,
    href: line.sourceHref,
    capturedLabel: formatCapturedDate(line.capturedAt),
    fileId: chosen.fileId,
    mime: chosen.mime,
    linkPart: chosen.linkPart,
    gmailHref: gmailLinkFor(line.sourceDocument, line.sourceHref, line.sourcePage, gmailAllowed && !chosen.fileId),
  });
  return {
    ...line,
    sourceDocument: packageParts(line.sourceDocument) ? line.sourceDocument : view.label,
    sourceHref: view.href,
    gmailHref: view.gmailHref,
    sourceLinkPart: view.linkPart,
  };
}

function presentMissing(detail: MissingDetail, found: Map<string, { id: string; mime: string } | null>, gmailAllowed: boolean): MissingDetail {
  const chosen = chosenFile(detail.sourceDocument, detail.sourceHref || "", found);
  const view = sourceView({
    document: detail.sourceDocument,
    page: detail.sourcePage,
    href: detail.sourceHref || "",
    capturedLabel: formatCapturedDate(detail.capturedAt),
    fileId: chosen.fileId,
    mime: chosen.mime,
    linkPart: chosen.linkPart,
    gmailHref: gmailLinkFor(detail.sourceDocument, detail.sourceHref || "", detail.sourcePage, gmailAllowed && !chosen.fileId),
  });
  return {
    ...detail,
    sourceDocument: packageParts(detail.sourceDocument) ? detail.sourceDocument : view.label,
    sourceHref: view.href,
    gmailHref: view.gmailHref,
    sourceLinkPart: view.linkPart,
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
  const take = (document: string, href: string) => {
    if (driveFileIdFromHref(href) || bareFileId(document)) return;
    names.push(...lookupNames(document));
  };
  const takePeriod = (period: PnlPeriodView | null) => {
    if (!period) return;
    for (const line of [...period.revenue, ...period.costs, ...period.results, ...period.addbacks]) take(line.sourceDocument, line.sourceHref);
  };
  for (const year of [...statement.years, ...statement.normalizedYears]) {
    takePeriod(year.annual);
    for (const period of year.ranges) takePeriod(period);
    for (const period of year.months) takePeriod(period);
    for (const detail of year.missingDetails) take(detail.sourceDocument, detail.sourceHref || "");
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
