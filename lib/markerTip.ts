import { listingCue } from "@/lib/format";
import { spareTier } from "@/lib/filter";
import { AREA_KIND_LABEL, STATUS_NOTES, stageDetail, stageTitle, statusOf, tierLabel } from "@/lib/labels";
import { acresText, depotLine, openLandText } from "@/lib/keyNumbers";

export type TipMark = { swatch: string; label: string };
export type TipFact = { label: string; value: string };
export type TipModel = { title: string; marks: TipMark[]; extra?: string; facts?: TipFact[] };

const AREA_NAMES: Record<string, string> = {
  "phx-service": "Phoenix service area",
  "las-core": "Las Vegas core",
  "las-100": "Las Vegas service area",
  "las-200": "Las Vegas later expansion",
  "las-300": "Las Vegas later expansion",
  "mia-current": "Miami service area",
  "mia-launch": "Miami launch area",
  "mia-extended": "Miami extended area",
  "mia-future": "Miami future boundary",
  "mia-pri-ftl": "Miami priority area",
  "mia-pri-hl": "Miami priority area",
  "mia-pri-fb": "Miami priority area",
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function siteName(props: Record<string, unknown>) {
  return text(props.name) || text(props.address) || text(props.site_id) || "Site";
}

export function siteTip(props: Record<string, unknown>, offMarket = false): TipModel {
  const marks: TipMark[] = [];
  if (offMarket || props.origin === "off-market") {
    marks.push({ swatch: "offmarket", label: STATUS_NOTES.find((item) => item.id === "offmarket")!.label });
  } else {
    const status = statusOf(props as { verdict?: string | null; network_status?: string | null; tenure_fail?: boolean });
    marks.push({ swatch: status.id, label: status.label });
  }
  if (props.land_only) {
    marks.push({ swatch: "land", label: STATUS_NOTES.find((item) => item.id === "land")!.label });
  }
  if (props.listed) {
    marks.push({ swatch: "listing", label: STATUS_NOTES.find((item) => item.id === "listing")!.label });
  }
  const tierCode = spareTier({ spare_ac_own: typeof props.spare_ac_own === "number" ? props.spare_ac_own : null });
  const tier = tierLabel(tierCode);
  if (tier) marks.push({ swatch: tierCode === "L10" ? "l10" : "l4", label: tier });
  return { title: siteName(props), marks, extra: text(props.business_type) };
}

export function dealTip(props: Record<string, unknown>): TipModel {
  const marks: TipMark[] = [];
  if (props.kind === "land") {
    marks.push({ swatch: "land", label: STATUS_NOTES.find((item) => item.id === "land")!.label });
  } else if (props.stage_group === "desk") {
    marks.push({ swatch: "desk", label: STATUS_NOTES.find((item) => item.id === "desk")!.label });
  } else {
    const group = text(props.stage_group) || "desk";
    marks.push({ swatch: `stage-${group}`, label: stageTitle(group) });
  }
  if (props.listed) {
    marks.push({ swatch: "listing", label: STATUS_NOTES.find((item) => item.id === "listing")!.label });
  }
  const acres = typeof props.land_acres === "number" ? acresText(props.land_acres) : "";
  const open = typeof props.open_land_sqft === "number" ? openLandText(props.open_land_sqft) : "";
  const miles = typeof props.miles_to_depot === "number" ? props.miles_to_depot : null;
  const facts: TipFact[] = [
    { label: "Stage", value: stageDetail(text(props.stage), text(props.stage_group) || "desk") },
    { label: "Asking", value: text(props.asking_price_display) || "Not provided" },
    { label: "Acres", value: acres || "Not provided" },
    { label: "Per acre", value: text(props.price_per_acre_display) || "Not provided" },
    { label: "Open land", value: open || "Not measured" },
    { label: "Depot", value: depotLine(miles, miles != null) },
    { label: "Listing", value: listingCue({ listing_url: text(props.listing_url), listing_removed: Boolean(props.listing_removed) }).label },
  ];
  return {
    title: text(props.name) || text(props.address) || text(props.deal_id) || "Deal",
    marks,
    facts,
  };
}

export function depotTip(props: Record<string, unknown>): TipModel {
  return {
    title: text(props.address) || text(props.id) || "Depot",
    marks: [{ swatch: "depot", label: STATUS_NOTES.find((item) => item.id === "depot")!.label }],
  };
}

export function areaTip(props: Record<string, unknown>): TipModel {
  const id = text(props.id);
  const later = props.group === "expansion";
  return {
    title: AREA_NAMES[id] || text(props.name) || "Service area",
    marks: [{ swatch: later ? "later-area" : "current-area", label: later ? AREA_KIND_LABEL.later : AREA_KIND_LABEL.current }],
  };
}

export function clusterTip(leaves: { properties?: Record<string, unknown> }[]): TipModel {
  const counts = new Map<string, { label: string; swatch: string; count: number; order: number }>();
  for (const leaf of leaves) {
    const status = statusOf((leaf.properties || {}) as { verdict?: string | null; network_status?: string | null; tenure_fail?: boolean });
    const current = counts.get(status.id);
    if (current) current.count += 1;
    else counts.set(status.id, { label: status.label, swatch: status.id, count: 1, order: STATUS_NOTES.findIndex((item) => item.id === status.id) });
  }
  const marks = [...counts.values()]
    .sort((a, b) => a.order - b.order)
    .map((item) => ({ swatch: item.swatch, label: `${item.count.toLocaleString()} ${item.label}` }));
  const n = leaves.length;
  return { title: `${n.toLocaleString()} site${n === 1 ? "" : "s"}`, marks };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);
}

export function tipHtml(tip: TipModel) {
  const rows = tip.marks
    .map((mark) => `<span class="map-tip-row"><i class="swatch ${escapeHtml(mark.swatch)}"></i>${escapeHtml(mark.label)}</span>`)
    .join("");
  const extra = tip.extra ? `<span class="map-tip-extra">${escapeHtml(tip.extra)}</span>` : "";
  const facts = (tip.facts || [])
    .map((fact) => `<span class="map-tip-fact"><em>${escapeHtml(fact.label)}</em>${escapeHtml(fact.value)}</span>`)
    .join("");
  return `<div class="map-tip"><strong>${escapeHtml(tip.title)}</strong>${rows}${facts}${extra}</div>`;
}
