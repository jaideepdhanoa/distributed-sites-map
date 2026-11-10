import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canReadFinancials } from "@/lib/agent/access";
import { actionsEnabled, withSql, type Sql } from "@/lib/actions/db";
import { listNotes } from "@/lib/actions/notes";
import { roleAllows, type ActionRole } from "@/lib/actions/roles";
import { listSuggestions } from "@/lib/actions/suggestions";
import { readGenerated } from "@/lib/guard";
import { loadFinancialPanel } from "@/lib/financialsLoad";
import { listAppEvents } from "@/lib/queue/events";
import { dealSearchParts, matchesQuery, siteSearchParts } from "@/lib/search";
import { presentCard } from "@/lib/timeline/filter";
import type { DealProps } from "@/lib/types";
import { listedDealsByMarket } from "./counts";
import { filterStageRows, listedStageRows } from "./stages";
import { redactPayload } from "./redact";

export const MAX_ASK_STEPS = 2;

export const ASK_TOOLS = [
  "searchSites",
  "getSite",
  "funnel",
  "portfolio",
  "stages",
  "discussion",
  "financials",
  "timeline",
  "activity",
] as const;

export type AskToolName = (typeof ASK_TOOLS)[number];

const QUARANTINE_ID = "PIPE-PHX-0006";

const SITE_FIELDS = [
  "site_id", "city", "name", "address", "apn", "site_class", "in_area", "verdict",
  "lot_ac", "owner", "listed", "contacted", "pipeline_stage", "business_type",
  "zoning", "stage", "linked_deal_id", "linked_deal_name", "linked_deal_stage",
] as const;

type Feature = { properties: Record<string, unknown> };

let siteFeatures: Feature[] | null = null;
let dealFeatures: Feature[] | null = null;
let quarantined: Set<string> | null = null;

function loadSites(): Feature[] {
  if (!siteFeatures) siteFeatures = (readGenerated("sites.geojson") as { features?: Feature[] }).features || [];
  return siteFeatures;
}

function loadDeals(): Feature[] {
  if (!dealFeatures) dealFeatures = (readGenerated("deals.geojson") as { features?: Feature[] }).features || [];
  return dealFeatures;
}

export function quarantineIds(): Set<string> {
  if (quarantined) return quarantined;
  const ids = new Set<string>([QUARANTINE_ID]);
  for (const feature of loadSites()) {
    const props = feature.properties;
    if (props.quarantine !== true) continue;
    if (props.site_id) ids.add(String(props.site_id));
    if (props.linked_deal_id) ids.add(String(props.linked_deal_id));
    if (props.pipeline_id) ids.add(String(props.pipeline_id));
  }
  quarantined = ids;
  return ids;
}

export function isQuarantined(id: string): boolean {
  return quarantineIds().has(id.trim());
}

export function quarantinedRecord(id: string) {
  return { id, status: "quarantined" as const, label: "Quarantined" };
}

function siteHref(id: string): string {
  return `/?site=${encodeURIComponent(id)}`;
}

function pick(props: Record<string, unknown>, keys: readonly string[]) {
  const out: Record<string, unknown> = {};
  for (const key of keys) if (props[key] != null && props[key] !== "") out[key] = props[key];
  return out;
}

function findSite(id: string): Record<string, unknown> | null {
  return loadSites().find((feature) => feature.properties.site_id === id)?.properties || null;
}

function findDeal(id: string): Record<string, unknown> | null {
  return loadDeals().find((feature) => feature.properties.deal_id === id)?.properties || null;
}

async function searchSites(query: string) {
  const needle = query.trim();
  if (needle.length < 2) return { results: [] };
  const results: Record<string, unknown>[] = [];
  for (const feature of loadDeals()) {
    const props = feature.properties;
    const id = String(props.deal_id || "");
    if (!id || !matchesQuery(needle, dealSearchParts(props as { deal_id?: string; name?: string; address?: string }))) continue;
    results.push(isQuarantined(id) ? quarantinedRecord(id) : {
      id,
      kind: "deal",
      label: props.name || id,
      city: props.city || "",
      href: siteHref(id),
    });
    if (results.length >= 8) return { results };
  }
  for (const feature of loadSites()) {
    const props = feature.properties;
    const id = String(props.site_id || "");
    if (!id || !matchesQuery(needle, siteSearchParts(props as { site_id?: string; name?: string; address?: string }))) continue;
    results.push(isQuarantined(id) ? quarantinedRecord(id) : {
      id,
      kind: "site",
      label: props.name || id,
      city: props.city || "",
      href: siteHref(id),
    });
    if (results.length >= 8) break;
  }
  return { results };
}

function getSite(id: string) {
  const key = id.trim();
  if (!key) return { error: "not_found" };
  if (isQuarantined(key)) return quarantinedRecord(key);
  const deal = findDeal(key);
  if (deal) {
    return {
      id: key,
      kind: "deal",
      label: deal.name || key,
      href: siteHref(key),
      ...pick(deal, ["city", "address", "stage", "stage_group", "business_type", "listed", "universe_id"]),
    };
  }
  const site = findSite(key);
  if (!site) return { error: "not_found" };
  return { id: key, kind: "site", label: site.name || key, href: siteHref(key), ...pick(site, SITE_FIELDS) };
}

function funnel() {
  const file = readGenerated("funnel.json") as { stages?: { id?: string; name?: string; total?: number }[] };
  return {
    href: "/?funnel=pipeline",
    label: "Funnel",
    stages: (file.stages || []).map((stage) => ({ id: stage.id, name: stage.name, total: stage.total })),
  };
}

function portfolio() {
  const report = JSON.parse(readFileSync(join(process.cwd(), "data", "generated", "build_report.json"), "utf8")) as {
    generated_at?: string;
    changes?: { new_sites?: number; verdict_changes?: number; stage_moves?: number };
  };
  return {
    href: "/",
    label: "Portfolio",
    generatedAt: report.generated_at || "",
    changes: report.changes || {},
    listedByMarket: listedDealsByMarket(),
  };
}

function stages(market?: string, stage?: string) {
  const rows = filterStageRows(listedStageRows(isQuarantined), market, stage);
  return {
    href: "/",
    label: "Stages",
    count: rows.length,
    rows,
  };
}

async function discussion(id: string) {
  if (isQuarantined(id)) return quarantinedRecord(id);
  if (!actionsEnabled()) return { available: false, note: "Discussion is not connected." };
  return withSql(async (sql) => {
    const notes = [
      ...(await listNotes(sql, "deal", id)),
      ...(await listNotes(sql, "site", id)),
    ].slice(0, 20);
    const suggestions = [
      ...(await listSuggestions(sql, { targetKind: "deal", targetId: id })),
      ...(await listSuggestions(sql, { targetKind: "site", targetId: id })),
    ].slice(0, 20);
    return {
      id,
      href: `${siteHref(id)}&panel=discussion`,
      label: "Discussion",
      notes: notes.map((note) => ({ id: note.id, authorId: note.authorId, body: note.body, href: `${siteHref(id)}&panel=discussion` })),
      suggestions: suggestions.map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        field: item.field,
        proposedValue: item.proposedValue,
        href: `${siteHref(id)}&panel=discussion`,
      })),
    };
  });
}

function financials(id: string) {
  if (isQuarantined(id)) return quarantinedRecord(id);
  const deal = findDeal(id) || (findSite(id)?.linked_deal_id ? findDeal(String(findSite(id)?.linked_deal_id)) : null);
  if (!deal) return { error: "not_found" };
  const panel = loadFinancialPanel(deal as unknown as DealProps, true);
  return {
    id,
    href: siteHref(id),
    label: "Financials",
    headline: panel.headline.text,
    figures: panel.figures.slice(0, 12).map((item) => ({ figure: item.figure, period: item.periodLabel, text: item.text })),
    checklist: panel.checklist.map((item) => ({ id: item.id, state: item.state })),
  };
}

function timeline(id: string) {
  if (isQuarantined(id)) return quarantinedRecord(id);
  const raw = JSON.parse(readFileSync(join(process.cwd(), "data", "generated", "timeline.json"), "utf8"));
  const card = presentCard(raw, [id]);
  return {
    id,
    href: `${siteHref(id)}&panel=activity`,
    label: "Timeline",
    lastTouched: card.lastTouched,
    items: card.items.slice(0, 20).map((item) => ({ type: item.type, summary: item.summary, at: item.date, href: `${siteHref(id)}&panel=activity` })),
  };
}

async function activity(id: string) {
  if (isQuarantined(id)) return quarantinedRecord(id);
  const card = timeline(id) as { items?: unknown[]; href: string; label: string };
  let events: { type: string; summary: string; at: string; href: string }[] = [];
  if (actionsEnabled()) {
    const rows = await withSql((sql: Sql) => listAppEvents(sql));
    events = rows.filter((row) => row.siteId === id).slice(-20).map((row) => ({
      type: row.type,
      summary: row.summary,
      at: row.at,
      href: `${siteHref(id)}&panel=activity`,
    }));
  }
  return { id, href: card.href, label: "Activity", timeline: card.items || [], events };
}

export async function runAskTool(
  name: string,
  args: Record<string, unknown>,
  role: ActionRole | string,
): Promise<unknown> {
  if (!(ASK_TOOLS as readonly string[]).includes(name)) return { error: "unknown_tool" };
  if (!roleAllows(role as ActionRole, "viewer")) return { error: "not_allowed" };
  if (name === "financials" && !canReadFinancials(role)) return { error: "not_allowed" };
  const id = String(args.id || args.siteId || "").trim();
  let raw: unknown;
  if (name === "searchSites") raw = await searchSites(String(args.query || ""));
  else if (name === "getSite") raw = getSite(id);
  else if (name === "funnel") raw = funnel();
  else if (name === "portfolio") raw = portfolio();
  else if (name === "stages") raw = stages(String(args.market || ""), String(args.stage || ""));
  else if (name === "discussion") raw = await discussion(id);
  else if (name === "financials") raw = financials(id);
  else if (name === "timeline") raw = timeline(id);
  else raw = await activity(id);
  if (raw && typeof raw === "object" && (raw as { status?: string }).status === "quarantined") return raw;
  return redactPayload(raw, role as ActionRole);
}
