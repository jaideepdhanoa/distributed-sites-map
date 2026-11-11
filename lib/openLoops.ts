import { coveredSites, daysSince, type NdaAgreement } from "./nda";

export const PARKED_BADGE = "Parked — owner's decision";
export const NO_COURT = "—";

export type LoopOwner = "Brief" | "Chase check" | "Panel only";
export type LoopClass = "NDA" | "Site";

export type OpenLoopSite = {
  site_id: string;
  label: string;
  market: string;
  stage: string;
  next_step: string;
  nda_id: string;
  stage_blocker: string;
  stage_blocker_since: string;
};

export type OpenLoopRegister = Pick<
  NdaAgreement,
  | "nda_id"
  | "counterparty_firm"
  | "counterparty_person"
  | "site_ids"
  | "nda_status"
  | "nda_waiting_on"
  | "nda_waiting_on_since"
  | "nda_gates"
  | "nda_days_open"
  | "nda_days_in_court"
>;

export type OpenLoopsSnapshot = {
  source: string;
  as_of: string;
  label: string;
  register: OpenLoopRegister[];
  sites: OpenLoopSite[];
};

export type OpenLoop = {
  loop_class: LoopClass;
  id: string;
  folded_site_ids: string[];
  site_note: string;
  party: string;
  label: string;
  market: string;
  markets: string[];
  stage: string;
  court: string;
  days: number;
  detail: string;
  next_step: string;
  owner: LoopOwner;
  parked: boolean;
  brief_flagged: boolean;
};

export type DerivedLoops = {
  loops: OpenLoop[];
  parked: OpenLoop[];
};

export type LoopFilters = {
  court: "all" | "us" | "them" | "none";
  loopClass: "all" | LoopClass;
  market: string;
  age: "all" | "0-7" | "8-14" | "15+";
  owner: "all" | LoopOwner;
  showParked: boolean;
};

export const OPEN_LOOP_FILTERS: LoopFilters = {
  court: "all",
  loopClass: "all",
  market: "all",
  age: "all",
  owner: "all",
  showParked: false,
};

const BRIEF_BLOCKERS = new Set(["We owe a reply", "Our-side diligence", "NDA execution", "Awaiting package"]);

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  return String(value).trim();
}

/** A date-formatted zero is 0. Any other date is not a day count. */
export function courtDayCount(value: unknown): number | null {
  if (typeof value === "string") {
    const raw = value.trim();
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(raw)) {
      return raw === "12/30/1899" || raw === "12/30/99" ? 0 : null;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.startsWith("1899-12-30") ? 0 : null;
  }
  if (value == null || value === "" || typeof value === "boolean") return null;
  const number = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(number)) return null;
  return Math.round(number);
}

export function liveWaiting(value: string): boolean {
  return value.startsWith("Us") || value.startsWith("Them");
}

export function plainStage(stage: string): string {
  return stage.replace(/^\d+\s+/, "").trim();
}

function droppedStage(stage: string): boolean {
  return /^dropped$/i.test(plainStage(stage));
}

function blankBlocker(value: string): boolean {
  const raw = value.trim();
  return !raw || raw === "—" || raw === "-" || raw === "–";
}

/** Jaideep's park ruling in Next step. These rows stay off the default list and off the brief. */
export function isParkedDecision(nextStep: string): boolean {
  const raw = nextStep.toLowerCase();
  if (raw.includes("jaideep decided") && raw.includes("suggested drop")) return true;
  if (raw.includes("parked as a suggested drop")) return true;
  if (raw.includes("monitor only") && raw.includes("parked")) return true;
  return false;
}

export function siteCourt(blocker: string, waiting: string): string {
  if (blocker === "We owe a reply" || blocker === "Our-side diligence") return "Us";
  if (blocker === "Awaiting broker reply" || blocker === "Awaiting package") return "Them — broker";
  if (blocker === "NDA execution") {
    if (liveWaiting(waiting)) return waiting;
    return "Them — signer";
  }
  return NO_COURT;
}

export function loopOwner(loopClass: LoopClass, blocker: string): LoopOwner {
  if (loopClass === "NDA") return "Brief";
  if (blocker === "Awaiting broker reply") return "Chase check";
  if (BRIEF_BLOCKERS.has(blocker)) return "Brief";
  return "Panel only";
}

export function courtGroup(court: string): number {
  if (court.startsWith("Us")) return 0;
  if (court.startsWith("Them")) return 1;
  return 2;
}

export function sortLoops(rows: OpenLoop[]): OpenLoop[] {
  return rows.slice().sort((a, b) => {
    const group = courtGroup(a.court) - courtGroup(b.court);
    if (group) return group;
    if (a.days !== b.days) return b.days - a.days;
    return a.id.localeCompare(b.id);
  });
}

function clip(value: string, limit = 180): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit - 1).trimEnd()}…`;
}

export function shortStep(value: string): string {
  const line = value.split(/\n/, 1)[0] ?? "";
  const sentence = line.split(/(?<=[.!?])\s+/)[0] ?? line;
  return clip(sentence);
}

function ndaCourtDays(row: OpenLoopRegister, asOf: string): number {
  const numeric = courtDayCount(row.nda_days_in_court);
  if (numeric != null && numeric >= 0) return numeric;
  const computed = daysSince(row.nda_waiting_on_since || "", asOf);
  return computed ?? 0;
}

function siteDays(since: string, asOf: string): number {
  const computed = daysSince(since, asOf);
  return computed ?? 0;
}

function marketsFrom(ids: string[], prose: string, explicit: string[]): string[] {
  const found = new Set(explicit.filter(Boolean));
  for (const id of ids) {
    const match = /^(?:PIPE|LAND)-([A-Z]{2,4})-/.exec(id);
    if (match) found.add(match[1]);
  }
  if (found.size === 0) {
    const lower = prose.toLowerCase();
    if (lower.includes("las vegas")) found.add("LAS");
    if (lower.includes("phoenix")) found.add("PHX");
    if (lower.includes("miami")) found.add("MIA");
  }
  return [...found].sort();
}

function party(row: OpenLoopRegister): string {
  return [text(row.counterparty_firm), text(row.counterparty_person)].filter(Boolean).join(" · ");
}

function finish(row: Omit<OpenLoop, "brief_flagged">): OpenLoop {
  return {
    ...row,
    brief_flagged: !row.parked && row.owner === "Brief" && row.days > 7,
  };
}

export function deriveOpenLoops(snapshot: OpenLoopsSnapshot): DerivedLoops {
  const asOf = snapshot.as_of || "";
  const byNda = new Map(snapshot.register.map((row) => [row.nda_id, row]));
  const openNdas = snapshot.register.filter((row) => row.nda_id && liveWaiting(text(row.nda_waiting_on)));
  const openIds = new Set(openNdas.map((row) => row.nda_id));
  const folded = new Map<string, OpenLoopSite[]>();
  const siteLoops: OpenLoop[] = [];
  const parked: OpenLoop[] = [];

  for (const site of snapshot.sites) {
    if (!site.site_id || droppedStage(site.stage) || !site.stage.trim()) continue;
    if (blankBlocker(site.stage_blocker)) continue;
    const parkedRow = isParkedDecision(site.next_step || "");
    if (site.stage_blocker === "NDA execution" && site.nda_id && openIds.has(site.nda_id) && !parkedRow) {
      const list = folded.get(site.nda_id) || [];
      list.push(site);
      folded.set(site.nda_id, list);
      continue;
    }
    const waiting = text(byNda.get(site.nda_id)?.nda_waiting_on);
    const owner = loopOwner("Site", site.stage_blocker);
    const loop = finish({
      loop_class: "Site",
      id: site.site_id,
      folded_site_ids: [],
      site_note: "",
      party: "",
      label: text(site.label),
      market: text(site.market),
      markets: marketsFrom([site.site_id], "", [text(site.market)]),
      stage: plainStage(site.stage),
      court: siteCourt(site.stage_blocker, waiting),
      days: siteDays(site.stage_blocker_since || "", asOf),
      detail: site.stage_blocker,
      next_step: shortStep(site.next_step || ""),
      owner,
      parked: parkedRow,
    });
    if (parkedRow) parked.push(loop);
    else siteLoops.push(loop);
  }

  const ndaLoops = openNdas.map((row) => {
    const sites = (folded.get(row.nda_id) || []).slice().sort((a, b) => a.site_id.localeCompare(b.site_id));
    const covered = coveredSites(row.site_ids || "");
    const foldedIds = sites.map((site) => site.site_id);
    const steps = sites.map((site) => shortStep(site.next_step || "")).filter(Boolean);
    return finish({
      loop_class: "NDA",
      id: row.nda_id,
      folded_site_ids: foldedIds,
      site_note: covered.ids.length ? covered.note : text(row.site_ids),
      party: party(row),
      label: "",
      market: "",
      markets: marketsFrom(covered.ids.length ? covered.ids : foldedIds, row.site_ids || "", sites.map((site) => site.market)),
      stage: "",
      court: text(row.nda_waiting_on),
      days: ndaCourtDays(row, asOf),
      detail: text(row.nda_gates) || NO_COURT,
      next_step: clip(steps.join(" · ")),
      owner: "Brief",
      parked: false,
    });
  });

  return {
    loops: sortLoops([...ndaLoops, ...siteLoops]),
    parked: sortLoops(parked),
  };
}

export function briefSet(rows: OpenLoop[]): OpenLoop[] {
  return rows.filter((row) => !row.parked && row.owner === "Brief" && row.days > 7);
}

function ageBucket(days: number): LoopFilters["age"] {
  if (days <= 7) return "0-7";
  if (days <= 14) return "8-14";
  return "15+";
}

export function visibleLoops(derived: DerivedLoops, filters: LoopFilters): OpenLoop[] {
  const rows = filters.showParked ? [...derived.loops, ...derived.parked] : derived.loops;
  return sortLoops(rows.filter((row) => {
    if (filters.court === "us" && !row.court.startsWith("Us")) return false;
    if (filters.court === "them" && !row.court.startsWith("Them")) return false;
    if (filters.court === "none" && (row.court.startsWith("Us") || row.court.startsWith("Them"))) return false;
    if (filters.loopClass !== "all" && row.loop_class !== filters.loopClass) return false;
    if (filters.market !== "all" && !row.markets.includes(filters.market)) return false;
    if (filters.age !== "all" && ageBucket(row.days) !== filters.age) return false;
    if (filters.owner !== "all" && row.owner !== filters.owner) return false;
    return true;
  }));
}

export function openLoopsBody(snapshot: OpenLoopsSnapshot) {
  const derived = deriveOpenLoops(snapshot);
  return {
    source: snapshot.source,
    as_of: snapshot.as_of,
    label: snapshot.label,
    loops: derived.loops,
    parked: derived.parked,
  };
}
