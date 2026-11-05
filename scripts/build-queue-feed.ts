import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { safeSnapshot } from "../lib/policy/banned";
import { diffFeed, type ActivityMark, type ChangeEvent, type FeedSite, type MaterialMark } from "../lib/queue/diff";

const root = process.cwd();
const generated = join(root, "data", "generated");
const feedPath = join(generated, "queue_changes.json");

type FeedFile = { events: ChangeEvent[]; baseline: FeedSite[]; activity: ActivityMark[]; materials: MaterialMark[] };

function readJson(name: string): unknown {
  const path = join(generated, name);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function clean(value: unknown, max = 180): string {
  return safeSnapshot(String(value ?? ""), max);
}

function sitesFromDeals(): FeedSite[] {
  const deals = readJson("deals.geojson") as { features?: { properties?: Record<string, unknown> }[] } | null;
  const sites = readJson("sites.geojson") as { features?: { properties?: Record<string, unknown> }[] } | null;
  const verdictByDeal = new Map<string, string>();
  for (const feature of sites?.features || []) {
    const props = feature.properties || {};
    const linked = String(props.linked_deal_id || "");
    if (linked) verdictByDeal.set(linked, String(props.verdict || ""));
  }
  const out: FeedSite[] = [];
  for (const feature of deals?.features || []) {
    const props = feature.properties || {};
    if (props.kind !== "pipeline") continue;
    const id = String(props.deal_id || "");
    if (!id) continue;
    out.push({
      id,
      city: String(props.city || ""),
      stage: String(props.stage || ""),
      stageGroup: String(props.stage_group || ""),
      verdict: verdictByDeal.get(id) || "",
      askingPrice: String(props.asking_price_display || ""),
      askingSource: clean(props.asking_price_source, 160),
      active: props.stage_group !== "dropped",
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function timelineMarks(): { activity: ActivityMark[] | null; materials: MaterialMark[] | null } {
  const timeline = readJson("timeline.json") as {
    items?: { record_id?: string; event_id?: string; summary?: string }[];
    records?: Record<string, { materials?: { category?: string; label?: string; count?: number }[] }>;
  } | null;
  if (!timeline) return { activity: null, materials: null };
  const activity: ActivityMark[] = [];
  for (const item of timeline.items || []) {
    const summary = clean(item.summary, 240);
    if (!summary) continue;
    activity.push({ id: String(item.event_id || ""), siteId: String(item.record_id || ""), summary });
  }
  const materials: MaterialMark[] = [];
  for (const [siteId, record] of Object.entries(timeline.records || {})) {
    for (const item of record.materials || []) {
      const label = clean(item.label, 40);
      if (!label) continue;
      materials.push({ siteId, category: String(item.category || ""), label, count: Number(item.count || 0) });
    }
  }
  return { activity, materials };
}

function ship(event: ChangeEvent): ChangeEvent {
  const summary = safeSnapshot(event.summary, 240);
  if (summary) return { ...event, summary };
  const fallback: Record<ChangeEvent["type"], string> = {
    new_site: "New pipeline site.",
    stage: "Stage updated.",
    verdict: "Verdict updated.",
    activity: "New activity on file.",
    materials: "Materials count updated.",
    price: "Asking price updated.",
  };
  return { ...event, summary: fallback[event.type] };
}

function previous(): FeedFile | null {
  if (!existsSync(feedPath)) return null;
  try {
    return JSON.parse(readFileSync(feedPath, "utf8")) as FeedFile;
  } catch {
    return null;
  }
}

const nextSites = sitesFromDeals();
const marks = timelineMarks();
const prior = previous();
const at = new Date().toISOString();
const events = prior
  ? diffFeed({
    previous: prior.baseline,
    next: nextSites,
    previousActivity: prior.activity,
    nextActivity: marks.activity,
    previousMaterials: prior.materials,
    nextMaterials: marks.materials,
    at,
  }).map(ship)
  : [];
const file: FeedFile = {
  events: [...(prior?.events || []), ...events],
  baseline: nextSites,
  activity: marks.activity || [],
  materials: marks.materials || [],
};
mkdirSync(generated, { recursive: true });
writeFileSync(feedPath, `${JSON.stringify(file, null, 2)}\n`);
console.log(JSON.stringify({ added: events.length, total: file.events.length, sites: nextSites.length }));
