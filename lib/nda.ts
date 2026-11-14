import { canReadFinancials } from "./agent/access";
import { stageDetail } from "./labels";
import type { DealProps } from "./types";

/** Workbook default. Moove does not open an NDA until a broker asks. */
export const NOT_REQUIRED = "Not required";
export const NO_VALUE = "—";
export const NOT_GATING = "None — not gating (R-076)";

export const CLOSED_NDA_STATUSES = new Set([
  NOT_REQUIRED,
  "Executed",
  "Declined / proceeding without",
  "Expired",
]);

export type NdaMirror = {
  nda_id: string;
  nda_status: string;
  nda_waiting_on: string;
  nda_gates: string;
  nda_days_open: number | null;
  nda_days_in_court: number | null;
  stage_blocker: string;
  stage_blocker_since: string;
};

export type NdaAgreement = {
  nda_id: string;
  counterparty_firm: string;
  counterparty_person: string;
  scope: string;
  site_ids: string;
  nda_status: string;
  nda_form: string;
  nda_waiting_on: string;
  nda_opened_date: string;
  nda_sent_date: string;
  nda_last_action_date: string;
  nda_waiting_on_since: string;
  nda_executed_date: string;
  nda_gates: string;
  nda_days_open: number | null;
  nda_days_in_court: number | null;
  source: string;
  notes: string;
};

export type NdaSnapshot = {
  source: string;
  as_of: string;
  label: string;
  sites: Record<string, NdaMirror>;
  register: NdaAgreement[];
};

const MIRROR_KEYS: (keyof NdaMirror)[] = [
  "nda_id",
  "nda_status",
  "nda_waiting_on",
  "nda_gates",
  "nda_days_open",
  "nda_days_in_court",
  "stage_blocker",
  "stage_blocker_since",
];

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  return String(value).trim();
}

export function dayCount(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "boolean") return null;
  const number = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(number)) return null;
  return Math.round(number);
}

/** Days in the current court. A date-formatted zero (12/30/1899) is 0, not a calendar date. */
export function courtDayCount(value: unknown): number | null {
  if (typeof value === "string") {
    const raw = value.trim();
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(raw)) return raw === "12/30/1899" || raw === "12/30/99" ? 0 : null;
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.startsWith("1899-12-30") ? 0 : null;
  }
  return dayCount(value);
}

/** Blank on a site with no NDA ID is Not required. "Not started" is not a status. */
export function displayStatus(value: unknown, linked: boolean): string {
  const raw = text(value);
  if (/^not started$/i.test(raw)) return NOT_REQUIRED;
  if (!raw) return linked ? "" : NOT_REQUIRED;
  return raw;
}

export function defaultMirror(): NdaMirror {
  return {
    nda_id: "",
    nda_status: NOT_REQUIRED,
    nda_waiting_on: NO_VALUE,
    nda_gates: NOT_GATING,
    nda_days_open: null,
    nda_days_in_court: null,
    stage_blocker: NO_VALUE,
    stage_blocker_since: "",
  };
}

export function normalizeMirror(value: Partial<NdaMirror> | Record<string, unknown> | null | undefined): NdaMirror {
  const row = (value || {}) as Record<string, unknown>;
  const ndaId = text(row.nda_id);
  const linked = Boolean(ndaId);
  return {
    nda_id: ndaId,
    nda_status: displayStatus(row.nda_status, linked),
    nda_waiting_on: text(row.nda_waiting_on) || (linked ? "" : NO_VALUE),
    nda_gates: text(row.nda_gates) || (linked ? "" : NOT_GATING),
    nda_days_open: dayCount(row.nda_days_open),
    nda_days_in_court: courtDayCount(row.nda_days_in_court),
    stage_blocker: text(row.stage_blocker) || NO_VALUE,
    stage_blocker_since: text(row.stage_blocker_since),
  };
}

function clockParts(open: number | null, court: number | null): string[] {
  const parts: string[] = [];
  if (open != null) parts.push(`${open}d open`);
  if (court != null) parts.push(`${court}d in court`);
  return parts;
}

/** Listing chip from the site mirror. Days stay off when that clock is blank. */
export function ndaChip(value: Partial<NdaMirror> | Record<string, unknown> | null | undefined): string {
  const mirror = normalizeMirror(value);
  if (!mirror.nda_id || mirror.nda_status === NOT_REQUIRED) return NOT_REQUIRED;
  const parts: string[] = [];
  if (mirror.nda_status) parts.push(mirror.nda_status);
  if (mirror.nda_waiting_on && mirror.nda_waiting_on !== NO_VALUE) parts.push(mirror.nda_waiting_on);
  parts.push(...clockParts(mirror.nda_days_open, mirror.nda_days_in_court));
  return parts.length ? parts.join(" · ") : mirror.nda_id;
}

/**
 * Card chip. Hidden when no NDA is open, and hidden for a signed-out reader.
 * An open NDA is prefixed so it is not mistaken for a site status.
 */
export function cardNdaLabel(
  value: Partial<NdaMirror> | Record<string, unknown> | null | undefined,
  signedIn: boolean,
): string {
  if (!signedIn) return "";
  const mirror = normalizeMirror(value);
  if (!mirror.nda_id || !isOpenAgreement(mirror)) return "";
  const body = ndaChip(value);
  if (!body || body === NOT_REQUIRED) return "";
  return body.startsWith("NDA:") ? body : `NDA: ${body}`;
}

export function clockLine(open: number | null, court: number | null): string {
  return clockParts(open, court).join(" · ");
}

function calendar(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return { y, m, d };
}

/** Whole days from the blocker-since date to today. A missing date does not invent a count. */
export function daysSince(since: string, today: string): number | null {
  const start = calendar(since);
  const end = calendar(today);
  if (!start || !end) return null;
  const ms = Date.UTC(end.y, end.m - 1, end.d) - Date.UTC(start.y, start.m - 1, start.d);
  const days = Math.round(ms / 86400000);
  if (days < 0) return null;
  return days;
}

export function blockerSentence(input: {
  stage?: string;
  stageGroup?: string;
  blocker?: string;
  since?: string;
  today: string;
}): string {
  const blocker = text(input.blocker);
  if (!blocker || blocker === NO_VALUE) return "";
  const stage = stageDetail(input.stage || "", input.stageGroup || "desk");
  const days = daysSince(input.since || "", input.today);
  if (days == null) return `${stage} — blocked by ${blocker}`;
  const unit = days === 1 ? "day" : "days";
  return `${stage} — blocked by ${blocker} (${days} ${unit})`;
}

export function blockerSentenceForDeal(
  deal: Pick<DealProps, "stage" | "stage_group"> & Partial<Pick<DealProps, "stage_blocker" | "stage_blocker_since">>,
  today: string,
): string {
  return blockerSentence({
    stage: deal.stage,
    stageGroup: deal.stage_group,
    blocker: deal.stage_blocker,
    since: deal.stage_blocker_since,
    today,
  });
}

export function isOpenAgreement(row: Pick<NdaAgreement, "nda_status">): boolean {
  const status = displayStatus(row.nda_status, true);
  if (!status) return true;
  return !CLOSED_NDA_STATUSES.has(status);
}

/** Whose court. Waiting on wins when it disagrees with status. */
export function queueCourt(row: Pick<NdaAgreement, "nda_waiting_on">): string {
  const waiting = text(row.nda_waiting_on);
  if (waiting && waiting !== NO_VALUE) return waiting;
  return NO_VALUE;
}

export function openNdaQueue(rows: NdaAgreement[]): NdaAgreement[] {
  return rows.filter((row) => row.nda_id && isOpenAgreement(row)).slice().sort((a, b) => {
    const left = dayCount(a.nda_days_in_court);
    const right = dayCount(b.nda_days_in_court);
    if (left == null && right == null) return a.nda_id.localeCompare(b.nda_id);
    if (left == null) return 1;
    if (right == null) return -1;
    if (left !== right) return right - left;
    return a.nda_id.localeCompare(b.nda_id);
  });
}

export function coveredSites(raw: string): { ids: string[]; note: string } {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const match of raw.matchAll(/\b(?:PIPE|LAND)-[A-Z]{2,4}-\d{4}\b/g)) {
    if (seen.has(match[0])) continue;
    seen.add(match[0]);
    ids.push(match[0]);
  }
  let note = raw;
  for (const id of ids) note = note.split(id).join(" ");
  note = note.replace(/[;,]+/g, " ").replace(/\s+/g, " ").trim();
  return { ids, note };
}

export function counterpartyLine(row: Pick<NdaAgreement, "counterparty_firm" | "counterparty_person">): string {
  return [text(row.counterparty_firm), text(row.counterparty_person)].filter(Boolean).join(" · ");
}

export function mirrorForDeal(props: Record<string, unknown>, sites: Record<string, NdaMirror>): NdaMirror {
  if (text(props.nda_id)) return normalizeMirror(props);
  const snap = sites[text(props.deal_id)];
  if (snap) return normalizeMirror(snap);
  return defaultMirror();
}

export function overlayDeals<T extends { features?: { properties?: Record<string, unknown> }[] }>(
  collection: T,
  snapshot: Pick<NdaSnapshot, "sites">,
): T {
  const sites = snapshot.sites || {};
  return {
    ...collection,
    features: (collection.features || []).map((feature) => {
      const properties = feature.properties || {};
      const mirror = mirrorForDeal(properties, sites);
      const next: Record<string, unknown> = { ...properties };
      for (const key of MIRROR_KEYS) next[key] = mirror[key];
      return { ...feature, properties: next };
    }),
  };
}

export function ndaQueueBody(snapshot: NdaSnapshot) {
  return {
    source: snapshot.source,
    as_of: snapshot.as_of,
    label: snapshot.label,
    queue: openNdaQueue(snapshot.register || []),
  };
}

export function ndaQueueAllowed(role: string): boolean {
  return canReadFinancials(role);
}
