import { readFileSync } from "node:fs";
import { join } from "node:path";

const ALLOWED = new Set(["listing", "brochure", "om", "financials", "photos", "legal", "doc", "visit", "stage"]);
const CATEGORY_ORDER = ["financials", "property_legal", "operations"] as const;
const CATEGORY_LABELS: Record<(typeof CATEGORY_ORDER)[number], string> = {
  financials: "Financials",
  property_legal: "Property and legal",
  operations: "Operations",
};
const FOLDER_URL = /^https:\/\/drive\.google\.com\/drive\/folders\/[A-Za-z0-9_-]+$/;

type Terms = { words?: string[]; phrases?: string[]; units?: string[] };
type Compiled = { words: RegExp[]; phrases: RegExp[]; unit: RegExp | null; phone: RegExp };

let compiled: Compiled | null = null;

function decode(value: string): string {
  const text = Buffer.from(value, "base64").toString("utf8");
  return text.startsWith("term:") ? text.slice(5) : text;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function policy(): Compiled {
  if (compiled) return compiled;
  const file = JSON.parse(readFileSync(join(process.cwd(), "config", "timeline-terms.json"), "utf8")) as Terms;
  const units = (file.units || []).map((item) => escapeRegExp(decode(item))).join("|");
  compiled = {
    words: (file.words || []).map((item) => new RegExp(`\\b${escapeRegExp(decode(item))}\\b`, "i")),
    phrases: (file.phrases || []).map((item) => new RegExp(escapeRegExp(decode(item)), "i")),
    unit: units ? new RegExp(`(?<![A-Za-z])\\d+(?:\\.\\d+)?\\s*(?:${units})\\b`, "i") : null,
    phone: /(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\b\d{3})[-.\s]\d{3}[-.\s]\d{4}\b/,
  };
  return compiled;
}

export function blockedText(text: string): boolean {
  const rules = policy();
  const value = text || "";
  if (value.includes("$") || value.includes("@")) return true;
  return rules.phone.test(value);
}

export function showActivityLines(): boolean {
  try {
    const config = JSON.parse(readFileSync(join(process.cwd(), "config", "timeline.json"), "utf8")) as {
      ui?: { showActivityLines?: boolean };
    };
    return config.ui?.showActivityLines !== false;
  } catch {
    return true;
  }
}

export type TimelineItem = {
  date: string;
  type: string;
  summary: string;
  eventId: string;
};

export type MaterialCount = {
  category: string;
  label: string;
  count: number;
  latest: string;
};

export type TimelineCard = {
  folderUrl: string;
  materials: MaterialCount[];
  lastTouched: string;
  items: TimelineItem[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function stageLine(summary: string): string {
  return summary.replace(/\s*\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
}

function presentItem(row: Record<string, unknown>): TimelineItem | null {
  const type = String(row.type || "");
  if (!ALLOWED.has(type)) return null;
  const raw = String(row.summary || "").trim();
  const summary = type === "stage" ? stageLine(raw) : raw;
  if (!summary || blockedText(summary)) return null;
  const date = String(row.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { date, type, summary, eventId: String(row.event_id || "") };
}

function presentMaterials(value: unknown): MaterialCount[] {
  if (!Array.isArray(value)) return [];
  const out: MaterialCount[] = [];
  for (const item of value) {
    const row = asRecord(item);
    if (!row) continue;
    const category = String(row.category || "");
    if (!CATEGORY_ORDER.includes(category as (typeof CATEGORY_ORDER)[number])) continue;
    const count = Number(row.count || 0);
    if (!Number.isFinite(count) || count <= 0) continue;
    const fixed = CATEGORY_LABELS[category as (typeof CATEGORY_ORDER)[number]];
    const supplied = String(row.label || "");
    out.push({
      category,
      label: supplied && !blockedText(supplied) ? supplied : fixed,
      count,
      latest: /^\d{4}-\d{2}-\d{2}$/.test(String(row.latest || "")) ? String(row.latest) : "",
    });
  }
  return out;
}

export function presentCard(raw: unknown, ids: string[]): TimelineCard {
  const wanted = ids.map((id) => id.trim()).filter(Boolean);
  const root = asRecord(raw);
  const records = asRecord(root?.records) || {};
  const source = Array.isArray(root?.items) ? (root.items as unknown[]) : [];
  let folderUrl = "";
  const totals = new Map<string, MaterialCount>();
  let lastTouched = "";
  for (const id of wanted) {
    const record = asRecord(records[id]);
    if (!record) continue;
    if (!folderUrl) {
      const candidate = String(record.folder_url || "");
      if (FOLDER_URL.test(candidate)) folderUrl = candidate;
    }
    for (const material of presentMaterials(record.materials)) {
      const current = totals.get(material.category);
      if (!current) {
        totals.set(material.category, { ...material });
        continue;
      }
      current.count += material.count;
      if (material.latest > current.latest) current.latest = material.latest;
    }
    const touched = String(record.last_touched || "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(touched) && touched > lastTouched) lastTouched = touched;
  }
  const items: TimelineItem[] = [];
  const seen = new Set<string>();
  for (const item of source) {
    const row = asRecord(item);
    if (!row || !wanted.includes(String(row.record_id || ""))) continue;
    const presented = presentItem(row);
    if (!presented) continue;
    const key = `${presented.eventId}|${presented.date}|${presented.type}|${presented.summary}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(presented);
  }
  items.sort((a, b) => b.date.localeCompare(a.date) || a.eventId.localeCompare(b.eventId));
  const materials = CATEGORY_ORDER.map((category) => totals.get(category)).filter((item): item is MaterialCount => Boolean(item));
  return { folderUrl, materials, lastTouched, items };
}

export function summaryRecords(raw: unknown): Record<string, { lastTouched: string; materials: number }> {
  const records = asRecord(asRecord(raw)?.records) || {};
  const out: Record<string, { lastTouched: string; materials: number }> = {};
  for (const [id, value] of Object.entries(records)) {
    const record = asRecord(value);
    if (!record) continue;
    const materials = presentMaterials(record.materials).reduce((sum, item) => sum + item.count, 0);
    const lastTouched = /^\d{4}-\d{2}-\d{2}$/.test(String(record.last_touched || "")) ? String(record.last_touched) : "";
    if (!materials && !lastTouched) continue;
    out[id] = { lastTouched, materials };
  }
  return out;
}
