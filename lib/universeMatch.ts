import { normalizeAddress } from "./quickLube";

/** Digits and letters only, so 123-45-678 and 12345678 are the same parcel. */
export function normalizeApn(value: string | null | undefined): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export type FactBag = Record<string, string>;

/** Keys present on both sides with different text. Blank incoming values do not conflict. */
export function factConflicts(stored: FactBag, incoming: FactBag): string[] {
  const fields: string[] = [];
  for (const [key, value] of Object.entries(incoming || {})) {
    const next = String(value ?? "").trim();
    if (!next) continue;
    const prior = String(stored?.[key] ?? "").trim();
    if (!prior) continue;
    if (prior !== next) fields.push(key);
  }
  return fields.sort();
}

export function sameAddress(left: string, right: string): boolean {
  const key = normalizeAddress(left);
  return Boolean(key) && key === normalizeAddress(right);
}
