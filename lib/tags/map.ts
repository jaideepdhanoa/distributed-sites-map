import { createHash } from "node:crypto";
import { isExcludedSite } from "@/lib/alerts/excluded";
import { tagCode, tagFamily, type TagTone } from "./vocab";

export type TagView = {
  family: string;
  code: string;
  label: string;
  tone: TagTone;
  help: string;
  since: string;
  note: string;
  owner: string;
  due: string;
  source: string;
};

export type TagDraft = {
  family: string;
  code: string;
  sinceIso: string;
  sourceRef: string;
  note: string;
  owner: string;
  due: string;
};

export type MappedTags = {
  chips: TagView[];
  drafts: TagDraft[];
  unmapped: { family: string; hash: string }[];
};

export type TagRecord = {
  siteId?: string;
  market?: string;
  stage?: string;
  stageReason?: string;
  blocker?: string;
  blockerSince?: string;
  nextStep?: string;
  gapText?: string;
  packageStatus?: string;
  ndaStatus?: string;
  photoStatus?: string;
  sourceKind?: string;
  leadSource?: string;
  listed?: boolean;
  listingRemoved?: boolean;
  listingStatus?: string;
  operating?: string;
  figuresBasis?: string;
  landBasis?: string;
  powerNotes?: string;
  zoning?: string;
  titleNote?: string;
  environmentalNote?: string;
  hasPrice?: boolean;
  priceVerified?: boolean;
  excelRow?: number | null;
};

const MARKET_OFFSET: Record<string, string> = {
  PHX: "-07:00",
  LAS: "-07:00",
  MIA: "-05:00",
  SNA: "-08:00",
};

const GAP_RULES: [string, RegExp][] = [
  ["lease_tenure", /\b(?:lease|tenure|tenant)\b/i],
  ["zoning", /\bzon(?:ing|ed)?\b/i],
  ["title", /\b(?:title|easement|deed)\b/i],
  ["power", /\b(?:power|electric|amps?|voltage|utility|kilowatt)\b/i],
  ["spare_land", /\b(?:spare|acres?|lot|stalls?|open land)\b/i],
  ["financials", /\b(?:financials?|revenue|cash flow|ebitda)\b/i],
  ["price", /\b(?:price|asking)\b/i],
  ["address", /\b(?:address|pin|location)\b/i],
  ["business_identity", /\b(?:operating|not a wash|business name|identity)\b/i],
];

const ACTION_RULES: [string, RegExp][] = [
  ["get_nda_signed", /\bnda\b/i],
  ["request_package", /\bpackage\b/i],
  ["measure_land", /\b(?:measure|survey|stalls?|acres?)\b/i],
  ["check_power", /\b(?:power|electric)\b/i],
  ["review_financials", /\b(?:financials?|revenue|cash flow)\b/i],
  ["decide", /\b(?:decide|decision)\b/i],
  ["follow_up", /\b(?:follow|reply|broker|waiting|nudge|call)\b/i],
];

export function tagHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

/** A calendar day at noon in the market, with a numeric offset. The day does not shift. */
export function calendarToZoned(value: string, market: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return "";
  const offset = MARKET_OFFSET[market.trim().toUpperCase()] || "-07:00";
  return `${match[1]}-${match[2]}-${match[3]}T12:00:00${offset}`;
}

export function sinceLabel(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!match) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[Number(match[2]) - 1];
  if (!month) return "";
  return `${month} ${Number(match[3])}`;
}

function blank(value: string | undefined): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function dash(value: string): boolean {
  return value === "" || value === "—" || value === "-" || /^n\/?a$/i.test(value) || /^none$/i.test(value);
}

function view(draft: TagDraft): TagView | null {
  const code = tagCode(draft.family, draft.code);
  const family = tagFamily(draft.family);
  if (!code || !family) return null;
  return {
    family: draft.family,
    code: draft.code,
    label: code.label,
    tone: code.tone,
    help: code.help,
    since: sinceLabel(draft.sinceIso),
    note: draft.note,
    owner: draft.owner,
    due: draft.due,
    source: draft.sourceRef,
  };
}

function push(drafts: TagDraft[], unmapped: MappedTags["unmapped"], family: string, code: string, extra: Partial<TagDraft> = {}, raw = ""): void {
  if (!code) {
    const text = blank(raw);
    if (text) unmapped.push({ family, hash: tagHash(text) });
    return;
  }
  if (!tagCode(family, code)) return;
  drafts.push({
    family,
    code,
    sinceIso: extra.sinceIso || "",
    sourceRef: extra.sourceRef || "",
    note: extra.note || "",
    owner: extra.owner || "",
    due: extra.due || "",
  });
}

function firstCode(rules: [string, RegExp][], text: string): string {
  const hit = rules.find((rule) => rule[1].test(text));
  return hit ? hit[0] : "";
}

/** The verb named first in the sentence. A later topic does not replace it. */
function earliestCode(rules: [string, RegExp][], text: string): string {
  let best = "";
  let at = text.length + 1;
  for (const [code, pattern] of rules) {
    const match = new RegExp(pattern.source, pattern.flags).exec(text);
    if (match && match.index < at) {
      at = match.index;
      best = code;
    }
  }
  return best;
}

function waitingCode(value: string): string {
  const text = blank(value);
  if (dash(text) || /^nothing$/i.test(text)) return "nothing";
  if (/^awaiting broker reply$/i.test(text) || /^broker reply$/i.test(text)) return "broker_reply";
  if (/^we owe a reply$/i.test(text) || /^us\/we owe a reply$/i.test(text)) return "we_owe";
  if (/^nda execution$/i.test(text)) return "nda_execution";
  if (/^our-side diligence$/i.test(text) || /^our side diligence$/i.test(text)) return "our_diligence";
  return "";
}

function packageCode(value: string): string {
  const text = blank(value).toLowerCase();
  if (!text || text === "none") return "none";
  if (text === "received" || text.includes("on file")) return "received";
  if (text.includes("refus") || text.includes("unavailable")) return "refused";
  return "";
}

function ndaCode(value: string): string {
  const text = blank(value);
  if (!text || /^not required$/i.test(text) || /^not started$/i.test(text)) return "not_required";
  if (/moove form sent/i.test(text)) return "moove_sent";
  if (/counterparty legal|their legal/i.test(text)) return "their_legal";
  if (/moove legal/i.test(text)) return "moove_legal";
  return "";
}

function photoCode(value: string): string {
  const text = blank(value).toLowerCase();
  if (text === "complete") return "complete";
  if (text === "deferred") return "deferred";
  if (text === "partial") return "partial";
  return "";
}

function leadCode(kind: string, lead: string): string {
  const text = `${kind} ${lead}`.toLowerCase();
  if (/off[\s-]*market/.test(text)) return "off_market";
  if (/listing|listed/.test(text)) return "listing";
  if (/broker/.test(text)) return "broker";
  return "";
}

function listingCode(record: TagRecord): string {
  const status = blank(record.listingStatus).toLowerCase();
  if (record.listingRemoved || /sold|withdrawn|gone|expired/.test(status)) return "sold_withdrawn";
  if (record.listed || status === "listed") return "listed";
  if (record.listed === false || /off[\s-]*market/.test(status)) return "off_market";
  return "";
}

function businessCode(value: string): string {
  const text = blank(value);
  if (!text) return "";
  if (/after nda/i.test(text)) return "operating_after_nda";
  if (/not operating|closed|no wash|not a wash|vacant|converted/i.test(text)) return "not_operating";
  if (/unconfirmed|not confirmed|unknown/i.test(text)) return "not_confirmed";
  if (/operating|\byes\b/i.test(text)) return "operating_confirmed";
  return "";
}

function checkCode(value: string, present: boolean): string {
  const text = blank(value).toLowerCase();
  if (/problem|fail|conflict/.test(text)) return "problem";
  if (/verif|document/.test(text)) return "verified";
  if (/claim/.test(text)) return "claimed";
  if (/estim/.test(text)) return "estimated";
  if (/unknown/.test(text) || !text) return present ? "claimed" : "unknown";
  return "claimed";
}

export function dropReasonCode(value: string): string {
  const text = blank(value).toLowerCase();
  if (!text) return "";
  if (/lot too small|stall|no land|too small/.test(text)) return "lot_too_small";
  if (/no longer for sale|not for sale|off the market/.test(text)) return "no_longer_for_sale";
  if (/outside (?:the )?service/.test(text)) return "outside_service_area";
  if (/not operating|business not/.test(text)) return "business_not_operating";
  if (/outside our market/.test(text)) return "outside_markets";
  if (/tenant lease|tenure/.test(text)) return "tenant_lease";
  if (/price vs value|too expensive/.test(text)) return "price_vs_value";
  if (/another buyer|sold to/.test(text)) return "sold_to_another";
  if (/duplicate/.test(text)) return "duplicate";
  if (/numbers don.t work|does not pencil|don.t pencil/.test(text)) return "numbers_dont_work";
  return "";
}

export function advanceReasonCode(value: string): string {
  const text = blank(value);
  if (!text) return "";
  const match = tagFamily("advance_reason")?.codes.find((item) => item.label.toLowerCase() === text.toLowerCase());
  return match?.code || "";
}

/** Map today's cells onto chip codes. The quarantined row is skipped whole. */
export function mapTags(record: TagRecord): MappedTags {
  if (isExcludedSite(record.siteId) || record.excelRow === 10) return { chips: [], drafts: [], unmapped: [] };
  const drafts: TagDraft[] = [];
  const unmapped: MappedTags["unmapped"] = [];
  const market = blank(record.market);
  const since = calendarToZoned(blank(record.blockerSince), market);
  const blocker = blank(record.blocker);
  push(drafts, unmapped, "waiting_on", waitingCode(blocker), {
    sinceIso: since,
    sourceRef: "stage_blocker",
    note: dash(blocker) ? "" : blocker,
  }, blocker);

  const step = blank(record.nextStep);
  const dedicatedGap = blank(record.gapText);
  const gapText = dedicatedGap || step;
  const action = step ? earliestCode(ACTION_RULES, step) : "";
  push(drafts, unmapped, "next_action", action, { sourceRef: "next_step", note: step }, step);
  const gap = gapText ? firstCode(GAP_RULES, gapText) : "";
  push(drafts, unmapped, "biggest_gap", gap, {
    sourceRef: dedicatedGap ? "biggest_gap" : "next_step",
    note: dedicatedGap,
  }, gap ? "" : gapText);

  const packageStatus = blank(record.packageStatus);
  push(drafts, unmapped, "package", packageCode(packageStatus), { sourceRef: "package_status" }, packageStatus);
  const nda = blank(record.ndaStatus);
  push(drafts, unmapped, "nda", ndaCode(nda), { sourceRef: "nda_status" }, nda && ndaCode(nda) ? "" : nda);
  const photos = blank(record.photoStatus);
  push(drafts, unmapped, "photos", photoCode(photos), { sourceRef: "photo_status" }, photos);
  const lead = leadCode(blank(record.sourceKind), blank(record.leadSource));
  push(drafts, unmapped, "lead_source", lead, { sourceRef: "lead_source" }, lead ? "" : `${record.sourceKind || ""} ${record.leadSource || ""}`.trim());
  const listing = listingCode(record);
  push(drafts, unmapped, "listing", listing, { sourceRef: "listing_status" });
  const operating = blank(record.operating);
  push(drafts, unmapped, "business_check", businessCode(operating), { sourceRef: "operating", note: operating }, businessCode(operating) ? "" : operating);

  const dropped = /^dropped\b/i.test(blank(record.stage));
  if (dropped) {
    const reason = blank(record.stageReason);
    push(drafts, unmapped, "drop_reason", dropReasonCode(reason), { sourceRef: "stage_reason", note: reason }, reason);
  }

  push(drafts, unmapped, "diligence_price", checkCode(record.priceVerified ? "verified" : "", Boolean(record.hasPrice)), { sourceRef: "asking_price" });
  push(drafts, unmapped, "diligence_financials", checkCode(blank(record.figuresBasis), false), { sourceRef: "figures_basis" });
  push(drafts, unmapped, "diligence_land", checkCode(blank(record.landBasis), false), { sourceRef: "land_basis" });
  push(drafts, unmapped, "diligence_power", checkCode(blank(record.powerNotes), false), { sourceRef: "power" });
  push(drafts, unmapped, "diligence_zoning", checkCode("", Boolean(blank(record.zoning))), { sourceRef: "zoning" });
  push(drafts, unmapped, "diligence_title", checkCode(blank(record.titleNote), false), { sourceRef: "title" });
  push(drafts, unmapped, "diligence_environmental", checkCode(blank(record.environmentalNote), false), { sourceRef: "environmental" });

  const chips = drafts.map(view).filter((chip): chip is TagView => Boolean(chip));
  return { chips, drafts, unmapped };
}

export function dealRecord(deal: {
  deal_id?: string;
  city?: string;
  stage?: string;
  stage_group?: string;
  stage_blocker?: string;
  stage_blocker_since?: string;
  next_step?: string;
  package_status?: string;
  nda_status?: string;
  photo_status?: string;
  source_kind?: string;
  lead_source?: string;
  listed?: boolean;
  listing_removed?: boolean;
  figures_basis?: string;
  land_acres_basis?: string;
  cap_a_confidence?: string | null;
  cap_b_confidence?: string | null;
  cap_c_confidence?: string | null;
  zoning?: string;
  asking_price?: number | null;
  asking_price_source?: string;
}): TagRecord {
  const power = [deal.cap_a_confidence, deal.cap_b_confidence, deal.cap_c_confidence].filter(Boolean).join(" ");
  const priceSource = blank(deal.asking_price_source);
  return {
    siteId: deal.deal_id,
    market: deal.city,
    stage: deal.stage_group === "dropped" ? "Dropped" : deal.stage,
    blocker: deal.stage_blocker,
    blockerSince: deal.stage_blocker_since,
    nextStep: deal.next_step,
    packageStatus: deal.package_status,
    ndaStatus: deal.nda_status,
    photoStatus: deal.photo_status,
    sourceKind: deal.source_kind,
    leadSource: deal.lead_source,
    listed: deal.listed,
    listingRemoved: deal.listing_removed,
    figuresBasis: deal.figures_basis,
    landBasis: deal.land_acres_basis,
    powerNotes: power,
    zoning: deal.zoning,
    hasPrice: deal.asking_price != null,
    priceVerified: /verif/i.test(priceSource),
  };
}
