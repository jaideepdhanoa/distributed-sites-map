import { readFileSync } from "node:fs";
import { join } from "node:path";

const ALLOWED = new Set(["call", "visit", "doc", "email", "brochure", "om", "financials", "photos"]);

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
  if (rules.phone.test(value)) return true;
  if (rules.unit?.test(value)) return true;
  if (rules.phrases.some((pattern) => pattern.test(value))) return true;
  return rules.words.some((pattern) => pattern.test(value));
}

export type TimelineItem = {
  date: string;
  type: string;
  summary: string;
  link: string;
};

export function presentTimeline(raw: unknown, ids: string[]): TimelineItem[] {
  const wanted = new Set(ids.map((id) => id.trim()).filter(Boolean));
  if (!wanted.size) return [];
  const source = raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items)
    ? (raw as { items: unknown[] }).items
    : [];
  const shown: TimelineItem[] = [];
  for (const item of source) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (!wanted.has(String(row.record_id || ""))) continue;
    const type = String(row.type || "");
    if (!ALLOWED.has(type)) continue;
    const summary = String(row.summary || "").trim();
    if (!summary || summary.includes("@") || blockedText(summary)) continue;
    const link = String(row.link || "");
    const date = String(row.date || "");
    shown.push({
      date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "",
      type,
      summary,
      link: /^https?:\/\/[^\s]+$/i.test(link) ? link : "",
    });
  }
  shown.sort((a, b) => b.date.localeCompare(a.date));
  return shown;
}
