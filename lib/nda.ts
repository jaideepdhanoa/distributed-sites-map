import { canReadFinancials } from "./agent/access";
import { chipLabelProblem } from "./chips";
import { stageDetail } from "./labels";
import type { DealProps } from "./types";

/** Workbook default. Moove does not open an NDA until a broker asks. */
export const NOT_REQUIRED = "Not required";
export const NO_VALUE = "—";
/** Stored rows may still carry the old rule code. The screen never shows it. */
export const NOT_GATING = "None — not gating (R-076)";
export function gateLabel(value?: string | null): string {
  return String(value || "").replace(/\s*\([RT]-\d+\)/g, "").replace(/\s+/g, " ").trim();
}

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

/** A saved dossier value wins. A comms-derived value fills only a blank field. */
export function preferSaved(saved: unknown, derived: unknown = ""): string {
  return text(saved) || text(derived);
}

export function dossierContacts(
  saved: { contact_name?: unknown; contact_email?: unknown; contact_phone?: unknown; document_url?: unknown },
  derived: { contact_name?: unknown; contact_email?: unknown; contact_phone?: unknown; document_url?: unknown } = {},
): { contact_name: string; contact_email: string; contact_phone: string; document_url: string } {
  return {
    contact_name: preferSaved(saved.contact_name, derived.contact_name),
    contact_email: preferSaved(saved.contact_email, derived.contact_email),
    contact_phone: preferSaved(saved.contact_phone, derived.contact_phone),
    document_url: preferSaved(saved.document_url, derived.document_url),
  };
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

/** User-facing clock. The stored field stays nda_days_in_court. */
export function waitingOnThemLabel(days: number): string {
  const full = `${days}d waiting on them`;
  if (!chipLabelProblem(full)) return full;
  return `${days}d with them`;
}

function clockParts(open: number | null, court: number | null): string[] {
  const parts: string[] = [];
  if (open != null) parts.push(`${open}d open`);
  if (court != null) parts.push(waitingOnThemLabel(court));
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

export type NdaHistoryItem = {
  status: string;
  note: string;
  actor: string;
  at: string;
};

export type NdaStateRow = {
  nda_id: string;
  status: string;
  waiting_on: string;
  owner: string;
  next_step: string;
  last_action: string;
  last_action_date: string;
  version: number;
  stage?: string;
  court?: string;
  court_detail?: string;
  court_since?: string;
  next_step_due?: string;
  document_url?: string;
  document_kind?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  gmail_thread_ids?: string[];
  covered_refs?: string[];
  source_ref?: string;
};

export type NdaQueueItem = NdaAgreement & {
  owner: string;
  owner_name?: string;
  next_step: string;
  last_action: string;
  version: number;
  history: NdaHistoryItem[];
  stage: string;
  court: string;
  court_detail: string;
  court_since: string;
  next_step_due: string;
  document_url: string;
  document_kind: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  gmail_thread_ids: string[];
  covered_refs: string[];
  source_ref: string;
  conflict: string;
  court_pill: string;
  days_court: number | null;
};

export function registerHistory(row: Pick<NdaAgreement, "nda_status" | "nda_last_action_date" | "nda_opened_date">): NdaHistoryItem {
  return {
    status: displayStatus(row.nda_status, true) || NO_VALUE,
    note: "On the register",
    actor: "",
    at: row.nda_last_action_date || row.nda_opened_date || "",
  };
}

const STAGE_LABEL: Record<string, string> = {
  requested: "Requested",
  our_form_sent: "Our form sent",
  their_form_received: "Their form received",
  redline_with_them: "Redline with them",
  redline_with_us: "Redline with us",
  with_moove_legal: "With Moove legal",
  routing_for_signature: "Routing for signature",
  counterparty_signed: "Counterparty signed",
  executed: "Executed",
  financials_requested: "Financials requested",
  financials_received: "Financials received",
  deferred: "Deferred",
  declined: "Declined",
  not_required: "Not required",
  expired: "Expired",
};

/** Suggested stage from a free-text register status. The original wording stays visible. */
export function suggestStage(status: string): string {
  const raw = status.toLowerCase();
  if (/not required|not started/.test(raw)) return "not_required";
  if (/executed/.test(raw)) return "executed";
  if (/declined/.test(raw)) return "declined";
  if (/expired/.test(raw)) return "expired";
  if (/financials received/.test(raw)) return "financials_received";
  if (/financials requested|proof of funds/.test(raw)) return "financials_requested";
  if (/deferred/.test(raw)) return "deferred";
  if (/moove legal/.test(raw)) return "with_moove_legal";
  if (/counterparty legal|their legal|redline with them/.test(raw)) return "redline_with_them";
  if (/our legal|redline with us/.test(raw)) return "redline_with_us";
  if (/form sent|our form/.test(raw)) return "our_form_sent";
  if (/their form|form received/.test(raw)) return "their_form_received";
  if (/signature|routing/.test(raw)) return "routing_for_signature";
  if (/counterparty signed/.test(raw)) return "counterparty_signed";
  if (raw) return "requested";
  return "";
}

export function stageLabel(stage: string): string {
  return STAGE_LABEL[stage] || stage;
}

export function courtFromWaiting(waiting: string): string {
  const raw = waiting.toLowerCase();
  if (!raw || raw === "—" || raw === "none") return "none";
  if (/\bus\b|moove|our/.test(raw)) return "us";
  if (/seller/.test(raw)) return "seller";
  if (/them|their|counterparty|broker|signer/.test(raw)) return "them";
  return "none";
}

export function courtPill(court: string, days: number | null): string {
  const count = days == null ? "" : ` ${days}d`;
  if (court === "us") return `Our court${count}`;
  if (court === "them" || court === "seller") return `Their court${count}`;
  return "";
}

/**
 * A conflict is a saved stage, court, or court-since that is newer than the
 * register's last action and does not match it. An owner, next step, or
 * document edit does not count.
 */
export function registerConflict(row: NdaAgreement, state?: NdaStateRow | null): string {
  if (!state) return "";
  const registerDate = text(row.nda_last_action_date);
  const savedDate = text(state.last_action_date);
  if (!registerDate || !savedDate || savedDate <= registerDate) return "";
  const suggested = suggestStage(displayStatus(row.nda_status, true));
  const registerCourt = courtFromWaiting(row.nda_waiting_on);
  const savedStage = text(state.stage);
  const savedCourt = text(state.court);
  const savedSince = text(state.court_since).slice(0, 10);
  const registerSince = text(row.nda_waiting_on_since).slice(0, 10);
  const stageDisagrees = Boolean(savedStage && suggested && savedStage !== suggested);
  const courtDisagrees = Boolean(savedCourt && savedCourt !== registerCourt);
  const sinceDisagrees = Boolean(savedSince && registerSince && savedSince !== registerSince);
  if (!stageDisagrees && !courtDisagrees && !sinceDisagrees) return "";
  return "Register last action is older than the latest saved record.";
}

export function collapseContained(parts: string[]): string[] {
  const kept: string[] = [];
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    const folded = part.toLowerCase();
    if (kept.some((item) => item.toLowerCase().includes(folded) && item.toLowerCase() !== folded)) continue;
    const contained = kept.findIndex((item) => folded.includes(item.toLowerCase()));
    if (contained >= 0) {
      kept[contained] = part;
      continue;
    }
    kept.push(part);
  }
  return kept;
}

function listOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean);
  return [];
}

function addressIn(value: string): string {
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : "";
}

function phoneIn(value: string): string {
  const match = value.match(/(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}/);
  return match ? match[0] : "";
}

export function presentNda(row: NdaAgreement, state?: NdaStateRow | null, history: NdaHistoryItem[] = [], today = ""): NdaQueueItem {
  const written = history.filter((item) => item.status || item.note);
  const stage = state?.stage || suggestStage(displayStatus(row.nda_status, true));
  const court = state?.court || courtFromWaiting(state?.waiting_on || row.nda_waiting_on);
  const since = text(state?.court_since) || text(row.nda_waiting_on_since) || text(row.nda_opened_date);
  const day = today ? daysSince(since.slice(0, 10), today) : null;
  const conflict = registerConflict(row, state);
  const contacts = dossierContacts(state || {}, { contact_name: row.counterparty_person });
  const registerText = `${row.notes || ""} ${row.source || ""}`;
  return {
    ...row,
    nda_status: state?.status || displayStatus(row.nda_status, true),
    nda_waiting_on: state?.waiting_on || row.nda_waiting_on,
    nda_last_action_date: state?.last_action_date || row.nda_last_action_date,
    owner: state?.owner || "",
    next_step: state?.next_step || "",
    last_action: state?.last_action || "",
    version: state ? Number(state.version) || 0 : 0,
    history: [registerHistory(row), ...written],
    stage,
    court,
    court_detail: text(state?.court_detail),
    court_since: since,
    next_step_due: text(state?.next_step_due),
    document_url: contacts.document_url,
    document_kind: text(state?.document_kind),
    contact_name: contacts.contact_name,
    contact_email: contacts.contact_email || addressIn(registerText),
    contact_phone: contacts.contact_phone || phoneIn(registerText),
    gmail_thread_ids: listOf(state?.gmail_thread_ids),
    covered_refs: listOf(state?.covered_refs),
    source_ref: text(state?.source_ref),
    conflict,
    court_pill: courtPill(court, day),
    days_court: day,
  };
}

export function presentQueue(rows: NdaAgreement[], states: NdaStateRow[] = [], history: (NdaHistoryItem & { nda_id: string })[] = [], today = ""): NdaQueueItem[] {
  const byId = new Map(states.map((row) => [row.nda_id, row]));
  const notes = new Map<string, NdaHistoryItem[]>();
  for (const row of history) {
    const list = notes.get(row.nda_id) || [];
    list.push({ status: row.status, note: row.note, actor: row.actor, at: row.at });
    notes.set(row.nda_id, list);
  }
  return openNdaQueue(rows)
    .map((row) => presentNda(row, byId.get(row.nda_id), notes.get(row.nda_id) || [], today))
    .filter((row) => isOpenAgreement(row));
}

/** The first covered Pipeline or Land row. Discussion stays on that site. */
export function discussionSite(row: Pick<NdaAgreement, "site_ids">): string {
  return coveredSites(row.site_ids || "").ids[0] || "";
}

export function lastActionLine(row: Pick<NdaQueueItem, "last_action" | "nda_last_action_date">): string {
  const action = text(row.last_action);
  const date = text(row.nda_last_action_date);
  if (action && date) return `${action} · ${date}`;
  return action || date || NO_VALUE;
}

export function ndaQueueBody(snapshot: NdaSnapshot) {
  return {
    source: snapshot.source,
    as_of: snapshot.as_of,
    label: snapshot.label,
    queue: presentQueue(snapshot.register || []),
  };
}

export function ndaQueueAllowed(role: string): boolean {
  return canReadFinancials(role);
}
