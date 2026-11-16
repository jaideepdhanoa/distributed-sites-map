import { readGeneratedOptional } from "@/lib/snapshot/read";
import { isProtectedId } from "@/lib/protectedSite";
import { foldSearch } from "@/lib/search";
import type { PaletteGroups, PaletteHit } from "./palette";

type DealRow = { deal_id?: string; name?: string; address?: string; broker?: string; firm?: string };
type CommsRow = { comms_id?: string; site_ids?: string; person?: string; firm?: string; summary?: string };

const EMPTY: PaletteGroups = { sites: [], brokers: [], conversations: [] };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function includes(query: string, value: string): boolean {
  const needle = foldSearch(query);
  const hay = foldSearch(value);
  if (needle.length < 2 || hay.length < 2) return false;
  return hay === needle || hay.includes(needle) || (hay.length >= 8 && needle.includes(hay));
}

function sitePath(id: string, extra?: { panel?: string; msg?: string }): string {
  const params = new URLSearchParams({ site: id });
  if (extra?.panel) params.set("panel", extra.panel);
  if (extra?.msg) params.set("msg", extra.msg);
  return `/?${params.toString()}`;
}

function hit(id: string, title: string, path: string): PaletteHit {
  return { id, title, path, url: `https://distributedsites.com${path}` };
}

function firstSite(value: string): string {
  for (const part of value.split(/[;,]/)) {
    const id = part.trim();
    if (id && !isProtectedId(id)) return id;
  }
  return "";
}

/** Group deals and comms the app already has. This does not write the database. */
export function groupSnapshot(query: string, deals: DealRow[], comms: CommsRow[]): PaletteGroups {
  const needle = query.trim();
  if (needle.length < 2) return EMPTY;
  const sites: PaletteHit[] = [];
  const brokers = new Map<string, PaletteHit>();
  for (const deal of deals) {
    const id = text(deal.deal_id);
    if (!id || isProtectedId(id)) continue;
    const name = text(deal.name) || id;
    const broker = text(deal.broker);
    const firm = text(deal.firm);
    if ([name, text(deal.address), id, broker, firm].some((value) => includes(needle, value))) {
      if (sites.length < 8) sites.push(hit(id, name, sitePath(id)));
    }
    const label = includes(needle, firm) ? firm : includes(needle, broker) ? broker : "";
    const key = foldSearch(label);
    if (!label || !key || brokers.has(key) || brokers.size >= 8) continue;
    brokers.set(key, hit(key, label, sitePath(id)));
  }
  const conversations: PaletteHit[] = [];
  for (const row of comms) {
    if (conversations.length >= 8) break;
    const id = text(row.comms_id);
    const siteId = firstSite(text(row.site_ids));
    if (!id || !siteId) continue;
    const person = text(row.person);
    const firm = text(row.firm);
    const summary = text(row.summary);
    if (![person, firm, summary].some((value) => includes(needle, value))) continue;
    conversations.push(hit(id, firm || person || "Conversation", sitePath(siteId, { panel: "activity", msg: id })));
  }
  return { sites, brokers: [...brokers.values()], conversations };
}

let cached: { deals: DealRow[]; comms: CommsRow[] } | null = null;

function records(): { deals: DealRow[]; comms: CommsRow[] } {
  if (cached) return cached;
  const dealsFile = readGeneratedOptional("deals.geojson") as { features?: { properties?: DealRow }[] } | undefined;
  const commsFile = readGeneratedOptional("comms.json") as { rows?: CommsRow[] } | undefined;
  cached = {
    deals: (dealsFile?.features || []).map((feature) => feature.properties || {}),
    comms: commsFile?.rows || [],
  };
  return cached;
}

export function searchSnapshot(query: string): PaletteGroups {
  try {
    const loaded = records();
    return groupSnapshot(query, loaded.deals, loaded.comms);
  } catch {
    return EMPTY;
  }
}
