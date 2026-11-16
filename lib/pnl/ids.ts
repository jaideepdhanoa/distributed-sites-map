export type RecordLink = { dealId: string; siteId: string };

/** The requested record plus its linked deal or universe site, requested id first. */
export function linkedPnlIds(requested: string, links: RecordLink[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  const add = (value: string) => {
    const text = value.trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    ids.push(text);
  };
  add(requested);
  for (const link of links) {
    if (link.dealId === requested || link.siteId === requested) {
      add(link.dealId);
      add(link.siteId);
    }
  }
  return ids;
}

/** Deal-to-universe pairs, skipping blanks and duplicates. */
export function linksFromRecords(records: { dealId?: string | null; siteId?: string | null }[]): RecordLink[] {
  const links: RecordLink[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const dealId = String(record.dealId || "").trim();
    const siteId = String(record.siteId || "").trim();
    if (!dealId || !siteId) continue;
    const key = `${dealId}\0${siteId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ dealId, siteId });
  }
  return links;
}
