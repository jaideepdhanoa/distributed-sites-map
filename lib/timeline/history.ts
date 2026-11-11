import type { TimelineItem } from "./filter";

export function mergeBringBackHistory(
  items: TimelineItem[],
  history: { summary: string; at?: string; eventId?: string; type?: string }[],
): TimelineItem[] {
  const extra: TimelineItem[] = [];
  for (const row of history) {
    const summary = String(row.summary || "").trim();
    if (!summary) continue;
    const day = String(row.at || "").slice(0, 10);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "";
    extra.push({ date, type: row.type || "bring_back", summary, eventId: row.eventId || "" });
  }
  const merged = [...items, ...extra];
  const seen = new Set<string>();
  const out: TimelineItem[] = [];
  for (const item of merged) {
    const key = `${item.eventId}|${item.date}|${item.type}|${item.summary}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  out.sort((a, b) => {
    if (!a.date && !b.date) return a.eventId.localeCompare(b.eventId);
    if (!a.date) return -1;
    if (!b.date) return 1;
    return b.date.localeCompare(a.date) || a.eventId.localeCompare(b.eventId);
  });
  return out;
}
