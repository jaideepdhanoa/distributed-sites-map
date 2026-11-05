import { readFileSync } from "node:fs";
import { join } from "node:path";

export const POLICY_MESSAGE = "That text is not allowed on the map. Rephrase it and try again.";

type PolicyFile = { words: string[]; phrases: string[]; units: string[] };

type Compiled = {
  words: RegExp[];
  phrases: RegExp[];
  unit: RegExp;
  phone: RegExp;
};

let compiled: Compiled | null = null;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeTerm(value: string): string {
  const text = Buffer.from(value, "base64").toString("utf8");
  const prefix = "term:";
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

function loadPolicy(): Compiled {
  if (compiled) return compiled;
  const file = JSON.parse(readFileSync(join(process.cwd(), "config", "display-policy.json"), "utf8")) as PolicyFile;
  const units = file.units.map((item) => escapeRegExp(decodeTerm(item))).join("|");
  compiled = {
    words: file.words.map((item) => new RegExp(`\\b${escapeRegExp(decodeTerm(item))}\\b`, "i")),
    phrases: file.phrases.map((item) => new RegExp(escapeRegExp(decodeTerm(item)), "i")),
    unit: new RegExp(`(?<![A-Za-z])\\d+(?:\\.\\d+)?\\s*(?:${units})\\b`, "i"),
    phone: /(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\b\d{3})[-.\s]\d{3}[-.\s]\d{4}\b/,
  };
  return compiled;
}

export function findPolicyHits(text: string): number {
  const policy = loadPolicy();
  const value = text || "";
  let hits = 0;
  if (policy.phone.test(value)) hits += 1;
  if (policy.unit.test(value)) hits += 1;
  for (const pattern of policy.phrases) if (pattern.test(value)) hits += 1;
  for (const pattern of policy.words) if (pattern.test(value)) hits += 1;
  return hits;
}

export class PolicyError extends Error {
  readonly code = "banned_term";
  constructor() {
    super(POLICY_MESSAGE);
  }
}

export function assertClean(text: string): void {
  if (findPolicyHits(text)) throw new PolicyError();
}

/** Drop a stored snapshot that would put blocked wording back on screen. */
export function safeSnapshot(value: unknown, max = 2000): string {
  const text = String(value ?? "").trim().slice(0, max);
  if (!text || findPolicyHits(text)) return "";
  return text;
}
