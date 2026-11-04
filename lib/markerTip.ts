import { AREA_KIND_LABEL, STATUS_NOTES, stageTitle, statusOf, tierLabel } from "@/lib/labels";

export type TipMark = { swatch: string; label: string };
export type TipModel = { title: string; marks: TipMark[]; extra?: string };

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
  const tier = tierLabel(text(props.land_tier));
  if (tier) marks.push({ swatch: props.land_tier === "L10" ? "l10" : "l4", label: tier });
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
  return {
    title: text(props.name) || text(props.address) || text(props.deal_id) || "Deal",
    marks,
    extra: text(props.business_type),
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
  return `<div class="map-tip"><strong>${escapeHtml(tip.title)}</strong>${rows}${extra}</div>`;
}
