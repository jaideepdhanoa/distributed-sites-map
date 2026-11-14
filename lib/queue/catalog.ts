import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isPipelineStore } from "@/lib/labels";
import { safeSnapshot } from "@/lib/policy/banned";
import type { ChangeEvent } from "./diff";

type DealProps = {
  deal_id?: string;
  kind?: string;
  city?: string;
  stage?: string;
  stage_group?: string;
  universe_id?: string;
  name?: string;
  address?: string;
  asking_price_display?: string | null;
  asking_price_source?: string;
  source_line?: string;
  firm?: string;
  folder_url?: string;
  is_c_store?: boolean;
  business_type?: string;
  description?: string;
  service_area_class?: string;
  in_area?: boolean;
};

type SiteProps = {
  site_id?: string;
  verdict?: string | null;
  linked_deal_id?: string;
};

export type CatalogSite = {
  id: string;
  city: string;
  stage: string;
  stageGroup: string;
  verdict: string;
  askingPrice: string;
  askingSource: string;
  leadSource: string;
  name: string;
  address: string;
  active: boolean;
  activity: string;
  materials: { label: string; count: number; latest: string }[];
  folderUrl: string;
  lng: number | null;
  lat: number | null;
  isCStore: boolean;
  businessType: string;
  description: string;
  serviceAreaClass: string;
  inArea: boolean | null;
};

function readJson(name: string): unknown {
  const path = join(process.cwd(), "data", "generated", name);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function clean(value: unknown, max = 180): string {
  return safeSnapshot(String(value ?? ""), max);
}

export function loadCatalog(): CatalogSite[] {
  const deals = readJson("deals.geojson") as { features?: { geometry?: { type?: string; coordinates?: number[] } | null; properties?: DealProps }[] } | null;
  const sites = readJson("sites.geojson") as { features?: { properties?: SiteProps }[] } | null;
  const timeline = readJson("timeline.json") as {
    items?: { record_id?: string; event_id?: string; date?: string; summary?: string; type?: string }[];
    records?: Record<string, { folder_url?: string; materials?: { label?: string; count?: number; latest?: string; category?: string }[]; last_touched?: string }>;
  } | null;
  const verdictByDeal = new Map<string, string>();
  for (const feature of sites?.features || []) {
    const props = feature.properties || {};
    const linked = String(props.linked_deal_id || "");
    if (linked) verdictByDeal.set(linked, String(props.verdict || ""));
  }
  const activityBySite = new Map<string, string>();
  if (timeline?.items) {
    const sorted = [...timeline.items].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    for (const item of sorted) {
      const id = String(item.record_id || "");
      if (!id || activityBySite.has(id)) continue;
      const summary = clean(item.summary, 240);
      if (summary) activityBySite.set(id, summary);
    }
  }
  const out: CatalogSite[] = [];
  for (const feature of deals?.features || []) {
    const props = feature.properties || {};
    if (props.kind !== "pipeline") continue;
    const id = String(props.deal_id || "");
    if (!id) continue;
    const record = timeline?.records?.[id];
    const materials = (record?.materials || [])
      .map((item) => ({
        label: clean(item.label, 40),
        count: Number(item.count || 0),
        latest: String(item.latest || ""),
      }))
      .filter((item) => item.label && item.count > 0);
    const folder = String(props.folder_url || record?.folder_url || "");
    const coords = feature.geometry?.type === "Point" ? feature.geometry.coordinates : null;
    const lng = Array.isArray(coords) ? Number(coords[0]) : null;
    const lat = Array.isArray(coords) ? Number(coords[1]) : null;
    out.push({
      id,
      city: String(props.city || ""),
      stage: String(props.stage || ""),
      stageGroup: String(props.stage_group || ""),
      verdict: verdictByDeal.get(id) || "",
      askingPrice: String(props.asking_price_display || ""),
      askingSource: clean(props.asking_price_source, 160),
      leadSource: clean(props.source_line || props.firm, 160),
      name: clean(props.name, 160),
      address: clean(props.address, 180),
      active: props.stage_group !== "dropped",
      activity: activityBySite.get(id) || "",
      materials,
      folderUrl: /^https:\/\/drive\.google\.com\/drive\/folders\/[A-Za-z0-9_-]+$/.test(folder) ? folder : "",
      lng: Number.isFinite(lng) ? lng : null,
      lat: Number.isFinite(lat) ? lat : null,
      isCStore: props.is_c_store === true || isPipelineStore({
        kind: props.kind,
        business_type: props.business_type,
        name: props.name,
        description: props.description,
        source_line: props.source_line,
      }),
      businessType: String(props.business_type || ""),
      description: String(props.description || props.source_line || ""),
      serviceAreaClass: String(props.service_area_class || ""),
      inArea: typeof props.in_area === "boolean" ? props.in_area : null,
    });
  }
  return out;
}

export function readBuildEvents(): ChangeEvent[] {
  const raw = readJson("queue_changes.json") as { events?: ChangeEvent[] } | null;
  if (!raw?.events) return [];
  return raw.events.filter((event) => event && event.siteId && event.summary && event.at);
}
