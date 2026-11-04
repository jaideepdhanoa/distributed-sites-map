import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { TargetKind } from "./text";

export type RecordLookup = (kind: TargetKind, id: string) => Record<string, unknown> | null;

type Cache = {
  key: string;
  sites: Map<string, Record<string, unknown>>;
  deals: Map<string, Record<string, unknown>>;
};

let cache: Cache | null = null;

function loadCollection(name: string): { mtime: number; rows: Map<string, Record<string, unknown>>; idKey: string } {
  const path = join(process.cwd(), "data", "generated", name);
  const mtime = statSync(path).mtimeMs;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { features?: { properties?: Record<string, unknown> }[] };
  const idKey = name.startsWith("deals") ? "deal_id" : "site_id";
  const rows = new Map<string, Record<string, unknown>>();
  for (const feature of parsed.features || []) {
    const props = feature.properties || {};
    const id = String(props[idKey] || "");
    if (id) rows.set(id, props);
  }
  return { mtime, rows, idKey };
}

export function fileLookup(): RecordLookup {
  const sitesPath = join(process.cwd(), "data", "generated", "sites.geojson");
  const dealsPath = join(process.cwd(), "data", "generated", "deals.geojson");
  const key = `${statSync(sitesPath).mtimeMs}:${statSync(dealsPath).mtimeMs}`;
  if (!cache || cache.key !== key) {
    cache = {
      key,
      sites: loadCollection("sites.geojson").rows,
      deals: loadCollection("deals.geojson").rows,
    };
  }
  const current = cache;
  return (kind, id) => (kind === "site" ? current.sites : current.deals).get(id) ?? null;
}

const STAGE_KEYS = ["stage", "pipeline_stage", "linked_deal_stage"];

export function recordField(record: Record<string, unknown> | null, field: string, detail: string | null): string {
  if (!record) return "";
  if (field === "listed" || field === "contacted") return record[field] ? "yes" : "no";
  if (field === "stage") {
    for (const key of STAGE_KEYS) {
      const value = record[key];
      if (value != null && String(value).trim()) return String(value).trim();
    }
    return "";
  }
  if (field === "flag") {
    return String(record.network_status || record.verdict || "").trim();
  }
  const key = field === "correction" ? detail || "" : field;
  if (!key) return "";
  const value = record[key];
  return value == null ? "" : String(value).trim();
}

export function valuesMatch(field: string, detail: string | null, proposed: string, record: Record<string, unknown> | null): boolean {
  if (!record) return false;
  const want = proposed.trim().toLowerCase();
  if (!want) return false;
  if (field === "listed" || field === "contacted") {
    const actual = Boolean(record[field]);
    if (/^(yes|true)$/i.test(proposed.trim())) return actual;
    if (/^(no|false)$/i.test(proposed.trim())) return !actual;
    return false;
  }
  if (field === "stage") {
    return STAGE_KEYS.some((key) => String(record[key] ?? "").trim().toLowerCase() === want);
  }
  if (field === "flag") {
    return [record.network_status, record.verdict].some((value) => String(value ?? "").trim().toLowerCase() === want);
  }
  const key = field === "correction" ? detail || "" : field;
  if (!key) return false;
  return String(record[key] ?? "").trim().toLowerCase() === want;
}
