import type { ActionRole } from "@/lib/actions/roles";

export const REFUSAL = "I can't help with that. Ask can look things up. It doesn't discuss price strategy, and it doesn't draft messages.";
export const UNKNOWN = "I don't know. I don't have a source for that.";

const HARD = [
  /walk[-\s]?away/i,
  /max(?:imum)?[-\s]?pay/i,
  /offer[-\s]?price/i,
  /\bsavings\b/i,
];

const DRAFT_MESSAGE = /(draft|write|compose|send)\b[\s\S]{0,80}\b(broker|seller)s?\b|\b(broker|seller)s?\b[\s\S]{0,80}\b(email|message|letter|text)\b/i;
const AV_OR_CHARGING = new RegExp(String.raw`\bAVs?\b|` + "auto" + "nomous vehicles?|" + "charg(?:e|ing)", "i");
const BROKER_FRAME = /\bbrokers?\b/i;

export type AskSource = { label: string; href: string };

export function hardRefuse(text: string): boolean {
  if (HARD.some((pattern) => pattern.test(text))) return true;
  if (DRAFT_MESSAGE.test(text)) return true;
  if (BROKER_FRAME.test(text) && AV_OR_CHARGING.test(text)) return true;
  return false;
}

function hasCitation(text: string): boolean {
  return /\[[^\]]+\]\((\/|\s*https:\/\/)/.test(text) || /https:\/\/\S+/.test(text);
}

export function applyWordingTier(text: string, _role: ActionRole, question: string): { text: string; refused: boolean } {
  if (hardRefuse(question) || hardRefuse(text)) return { text: REFUSAL, refused: true };
  return { text, refused: false };
}

export function withCitations(text: string, sources: AskSource[]): { text: string; gap: boolean; empty: boolean } {
  if (!text.trim()) return { text: "", gap: false, empty: true };
  if (text === REFUSAL) return { text, gap: false, empty: false };
  const linked = hasCitation(text);
  if (!sources.length && !linked) return { text: UNKNOWN, gap: true, empty: false };
  const gap = /\bi (?:don't|don’t|do not) know\b/i.test(text);
  if (!linked && sources.length) {
    const lines = sources.slice(0, 6).map((source) => `- [${source.label}](${source.href})`);
    return { text: `${text.trim()}\n\nSources:\n${lines.join("\n")}`, gap, empty: false };
  }
  return { text, gap, empty: false };
}

/** A shortlist answer may only cite evidence returned for its selected records. */
export function citedShortlistAnswer(text: string, sources: AskSource[]) {
  if (!text.trim() || text === REFUSAL) return withCitations(text, sources);
  const known = new Set(sources.map(source => source.href));
  const passages = text.trim().split(/\n\s*\n|\n(?=[-*]\s)/).filter(line =>
    !/^#{1,6}\s+[^\n]+$/.test(line.trim()));
  const grounded = passages.length > 0 && passages.every(line => {
    const links = Array.from(line.matchAll(/\[[^\]]+\]\(([^)]+)\)/g), match => match[1]);
    return links.length > 0 && links.every(link => known.has(link));
  });
  return grounded ? withCitations(text,sources) : { text: UNKNOWN, gap:true, empty:false };
}

export function collectSources(value: unknown, into: AskSource[] = [], seen = new Set<string>()): AskSource[] {
  if (!value || typeof value !== "object") return into;
  if (Array.isArray(value)) {
    for (const item of value) collectSources(item, into, seen);
    return into;
  }
  const row = value as Record<string, unknown>;
  const href = typeof row.href === "string" ? row.href : "";
  if (href.startsWith("/") && !seen.has(href)) {
    seen.add(href);
    const label = String(row.label || row.name || row.title || row.id || "Source").slice(0, 120);
    into.push({ label, href });
  }
  for (const child of Object.values(row)) collectSources(child, into, seen);
  return into;
}
