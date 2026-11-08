export type TargetKind = "site" | "deal";

export const SUGGESTION_FIELDS = [
  "stage",
  "flag",
  "correction",
  "name",
  "address",
  "next_step",
  "listed",
  "contacted",
  "asking_price_display",
  "asking_price_source",
  "proposed_next_step",
  "document_request",
] as const;

export type SuggestionField = (typeof SUGGESTION_FIELDS)[number];

export const CORRECTION_KEYS = [
  "name",
  "address",
  "stage",
  "pipeline_stage",
  "next_step",
  "zoning",
  "owner",
  "asking_price_display",
  "asking_price_source",
] as const;

const ID_OK = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

export class InputError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function parseTarget(kind: unknown, id: unknown): { targetKind: TargetKind; targetId: string } {
  if (kind !== "site" && kind !== "deal") throw new InputError("Choose a site or a deal.");
  const targetId = String(id ?? "").trim();
  if (!ID_OK.test(targetId)) throw new InputError("That record id is not valid.");
  return { targetKind: kind, targetId };
}

export function parseField(value: unknown): SuggestionField {
  const field = String(value ?? "").trim();
  if (!(SUGGESTION_FIELDS as readonly string[]).includes(field)) throw new InputError("That field cannot be suggested.");
  return field as SuggestionField;
}

export function parseDetail(field: SuggestionField, value: unknown): string | null {
  if (field === "proposed_next_step") {
    const detail = String(value ?? "").trim();
    return detail || null;
  }
  if (field !== "correction") return null;
  const detail = String(value ?? "").trim();
  if (!detail) return null;
  if (!(CORRECTION_KEYS as readonly string[]).includes(detail)) throw new InputError("That column cannot be suggested.");
  return detail;
}

export function parseDate(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new InputError("Use a calendar date.");
  return text;
}

export function parseBody(value: unknown, label: string, max: number): string {
  const text = String(value ?? "").trim();
  if (!text) throw new InputError(`Add a ${label}.`);
  if (text.length > max) throw new InputError(`${label[0].toUpperCase()}${label.slice(1)} must be ${max.toLocaleString()} characters or fewer.`);
  return text;
}

const QUERY_OK = /^[A-Za-z0-9._~&=%+\-|]*$/;

export function cleanQuery(input: unknown): string {
  let query = String(input ?? "").trim();
  if (query.startsWith("?")) query = query.slice(1);
  if (query.length > 4000) throw new InputError("That view is too long to save.");
  if (query.includes("://") || query.includes("\\") || /[\s<>]/.test(query) || !QUERY_OK.test(query)) {
    throw new InputError("That view link is not a map view.");
  }
  return query;
}

export function stamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return value == null ? "" : String(value);
}

export function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
