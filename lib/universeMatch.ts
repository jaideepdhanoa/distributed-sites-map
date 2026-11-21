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

const TRAILING_ZIP = / \d{5}$/;

/**
 * Exact normalized address, or the same address with a ZIP on only one side.
 * Two different ZIPs do not match. A blank address does not match.
 */
export function samePlaceAddress(left: string, right: string): boolean {
  const a = normalizeAddress(left);
  const b = normalizeAddress(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const aZip = TRAILING_ZIP.test(a);
  const bZip = TRAILING_ZIP.test(b);
  if (aZip === bZip) return false;
  return a.replace(TRAILING_ZIP, "") === b.replace(TRAILING_ZIP, "");
}
