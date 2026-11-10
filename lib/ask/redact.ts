import { findPolicyHits } from "@/lib/policy/banned";
import type { ActionRole } from "@/lib/actions/roles";

const PHONE = /(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\b\d{3})[-.\s]\d{3}[-.\s]\d{4}\b/g;
const HARD = [/walk[-\s]?away/gi, /max(?:imum)?[-\s]?pay/gi, /offer[-\s]?price/gi, /\bsavings\b/gi];
const DROP_KEYS = new Set([
  "phone",
  "phone_source",
  "owner_mail",
  "utility_proximity",
  "serving_utility",
  "serving_utility_source",
]);

function cleanString(value: string, role: ActionRole): string {
  let text = value.replace(PHONE, "").trim();
  for (const pattern of HARD) text = text.replace(pattern, "").trim();
  if (role !== "reviewer" && text && findPolicyHits(text)) return "";
  return text;
}

export function redactPayload(value: unknown, role: ActionRole): unknown {
  if (typeof value === "string") return cleanString(value, role);
  if (Array.isArray(value)) return value.map((item) => redactPayload(item, role));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (DROP_KEYS.has(key)) continue;
    const next = redactPayload(item, role);
    if (next === "") continue;
    out[key] = next;
  }
  return out;
}
