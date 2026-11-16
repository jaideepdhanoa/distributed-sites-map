import { formatActivityWhen } from "@/lib/actions/time";
import { commsStamp, type CommsRecord } from "@/lib/comms";
import { previewAtWord, withoutGmail } from "@/lib/displayText";
import { readGeneratedOptional } from "@/lib/snapshot/read";
import { isProtectedId } from "@/lib/protectedSite";
import { citySearchText, foldSearch, tokensMatch } from "@/lib/search";
import { siteResultDetail } from "@/lib/search/siteLine";
import type { PaletteGroups, PaletteHit } from "./palette";

type DealRow = {
  deal_id?: string;
  name?: string;
  address?: string;
  city?: string;
  business_type?: string;
  broker?: string;
  firm?: string;
  stage?: string;
  stage_group?: string;
  universe_id?: string;
};
type SiteRow = {
  site_id?: string;
  name?: string;
  address?: string;
  city?: string;
  linked_deal_id?: string;
};
type CommsRow = Partial<Pick<CommsRecord, "comms_id" | "site_ids" | "person" | "firm" | "summary" | "subject" | "at" | "at_iso" | "at_text" | "at_approximate">>;

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

function hit(id: string, title: string, path: string, extra?: { site?: string; when?: string; detail?: string }): PaletteHit {
  return {
    id,
    title,
    path,
    url: `https://distributedsites.com${path}`,
    ...(extra?.site ? { site: extra.site } : {}),
    ...(extra?.when ? { when: extra.when } : {}),
    ...(extra?.detail ? { detail: extra.detail } : {}),
  };
}

function dealDetail(deal: DealRow, id: string): string {
  return siteResultDetail({
    id,
    address: text(deal.address),
    city: text(deal.city),
    stage: text(deal.stage),
    stageGroup: text(deal.stage_group),
  });
}

function firstLine(value: string): string {
  const clean = withoutGmail(value).split("\n").map((line) => line.trim()).find(Boolean) || "";
  return previewAtWord(clean, 120).preview;
}

function firstSite(value: string): string {
  for (const part of value.split(/[;,]/)) {
    const id = part.trim();
    if (id && !isProtectedId(id)) return id;
  }
  return "";
}

/** Group deals and comms the app already has. This does not write the database. */
export function groupSnapshot(query: string, deals: DealRow[], comms: CommsRow[], catalog: SiteRow[] = []): PaletteGroups {
  const needle = query.trim();
  if (needle.length < 2) return EMPTY;
  const names = new Map<string, string>();
  const sites: PaletteHit[] = [];
  const brokers = new Map<string, PaletteHit>();
  for (const deal of deals) {
    const id = text(deal.deal_id);
    if (!id || isProtectedId(id)) continue;
    const name = text(deal.name) || id;
    names.set(id, name);
    const broker = text(deal.broker);
    const firm = text(deal.firm);
    const address = text(deal.address);
    const phrase = [name, address, id, broker, firm].some((value) => includes(needle, value));
    const words = tokensMatch(needle, [name, address, citySearchText(deal.city), text(deal.business_type)]);
    if ((phrase || words) && sites.length < 8) sites.push(hit(id, name, sitePath(id), { detail: dealDetail(deal, id) }));
    const label = includes(needle, firm) ? firm : includes(needle, broker) ? broker : "";
    const key = foldSearch(label);
    if (!label || !key || brokers.has(key) || brokers.size >= 8) continue;
    brokers.set(key, hit(key, label, sitePath(id)));
  }
  const listed = new Set(sites.map((item) => item.id));
  const universeOfListed = new Set(
    deals.filter((deal) => listed.has(text(deal.deal_id))).map((deal) => text(deal.universe_id)).filter(Boolean),
  );
  const dealById = new Map(deals.map((deal) => [text(deal.deal_id), deal]));
  for (const site of catalog) {
    if (listed.size >= 8) break;
    const id = text(site.site_id);
    if (!id || isProtectedId(id) || listed.has(id) || universeOfListed.has(id)) continue;
    const name = text(site.name);
    const address = text(site.address);
    const phrase = [name, address, id].some((value) => includes(needle, value));
    const words = tokensMatch(needle, [name, address, citySearchText(site.city)]);
    if (!phrase && !words) continue;
    const linked = dealById.get(text(site.linked_deal_id));
    const canonical = linked || deals.find((deal) => text(deal.universe_id) === id);
    if (canonical) {
      const dealId = text(canonical.deal_id);
      if (!dealId || listed.has(dealId)) continue;
      listed.add(dealId);
      sites.push(hit(dealId, text(canonical.name) || dealId, sitePath(dealId), { detail: dealDetail(canonical, dealId) }));
      continue;
    }
    listed.add(id);
    sites.push(hit(id, name || address || id, sitePath(id), {
      detail: siteResultDetail({ id, address, city: text(site.city), universe: true }),
    }));
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
    const subject = text(row.subject);
    if (![person, firm, summary, subject].some((value) => includes(needle, value))) continue;
    const title = firstLine(subject) || firstLine(summary) || "Conversation";
    const site = withoutGmail(names.get(siteId) || siteId);
    const stamp = commsStamp(row);
    const when = withoutGmail(formatActivityWhen(stamp.at, stamp.approximate).label);
    conversations.push(hit(id, title, sitePath(siteId, { panel: "activity", msg: id }), {
      ...(site ? { site } : {}),
      ...(when ? { when } : {}),
    }));
  }
  return { sites, brokers: [...brokers.values()], conversations };
}

let cached: { deals: DealRow[]; comms: CommsRow[]; sites: SiteRow[] } | null = null;

function records(): { deals: DealRow[]; comms: CommsRow[]; sites: SiteRow[] } {
  if (cached) return cached;
  const dealsFile = readGeneratedOptional("deals.geojson") as { features?: { properties?: DealRow }[] } | undefined;
  const sitesFile = readGeneratedOptional("sites.geojson") as { features?: { properties?: SiteRow }[] } | undefined;
  const commsFile = readGeneratedOptional("comms.json") as { rows?: CommsRow[] } | undefined;
  cached = {
    deals: (dealsFile?.features || []).map((feature) => feature.properties || {}),
    sites: (sitesFile?.features || []).map((feature) => feature.properties || {}),
    comms: commsFile?.rows || [],
  };
  return cached;
}

export function searchSnapshot(query: string): PaletteGroups {
  try {
    const loaded = records();
    return groupSnapshot(query, loaded.deals, loaded.comms, loaded.sites);
  } catch {
    return EMPTY;
  }
}
