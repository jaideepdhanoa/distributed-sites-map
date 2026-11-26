import { purchaseLabels, purchaseRows } from "./purchaseReview";
import type { DealProps, SiteProps } from "@/lib/types";
import { displayAddress, shownPriceSource } from "@/lib/format";
import { acresText, cashTile, comparisonPower, depotLine, factsForDeal, factsForSite, fullMoney, spareLandSqft, packageLine, powerSummary, sheetMoney, tradeAreaLines, universeTrafficLine, workbookTrafficLine } from "@/lib/keyNumbers";
import { basisBadge } from "@/lib/pricing";
import { stageDetail } from "@/lib/labels";
import { serviceAreaLabel } from "@/lib/cardStatus";
import { ndaChip } from "@/lib/nda";

export const MISSING = "—";

type CompareRow = { label: string; value: string; key?: string | number | null; basis?: string; source?: string };
export type ComparisonColumn = { id: string; title: string; rows: CompareRow[] };

export const compareSections = ["Power evidence", "Acquisition economics", "Financials", "Site fit", "Evidence quality", "Diligence", "Record details"] as const;
export const acquisitionCriteria = [...purchaseLabels,"Open land", "Bays that fit", "On-site service", "Street-frontage hosting", "Implied business price", "Business-only multiple", "Savings versus hub", "Service area", "Zoning", "Asking", "Revenue", "EBITDA", "Cash flow", "Asking / earnings", "Land estimate", "Reporting period", "Figure basis", "Financial source", "NDA", "Open evidence gaps", "Blocker", "Next check"];

function sectionFor(label: string): typeof compareSections[number] {
  if (["On-site service", "Street-frontage hosting"].includes(label)) return "Power evidence";
  if (["Asking", "Land estimate", "Implied business price", "Asking / earnings", "Business-only multiple", "Savings versus hub", "Pricing", "County value (land + buildings)", "Asking / revenue", "Per acre"].includes(label)) return "Acquisition economics";
  if (["Address", "Property owner"].includes(label)) return "Record details";
  if (["Financial package", "Cash flow coverage", "Figure basis", "Reporting period", "Financial source", "Land measurement"].includes(label)) return "Evidence quality";

  if (["Bays that fit", "Service area", "Traffic", "Land", "Open land", "Power", "3-mile population", "Washes", "Depot", "Zoning"].includes(label)) return "Site fit";
  if (["Stage", "Open evidence gaps", "NDA", "Suggested drop", "Next check", "Blocker"].includes(label)) return "Diligence";
  return "Financials";
}

function withEvidence(value: string, ...evidence: (string | undefined)[]) {
  if (!value || value === MISSING) return MISSING;
  return [value, ...new Set(evidence.filter(Boolean))].join(" · ");
}

function shown(value?: unknown) {
  const text = (typeof value === "string" ? value : value == null ? "" : String(value)).trim();
  return text || MISSING;
}

function powerRows(deal?: DealProps, site?: SiteProps): CompareRow[] {
  const { service, frontage } = comparisonPower(deal, site);
  return [
    { label: "On-site service", key: service?.value, source: service?.source,
      basis: service && (service.verified ? "Verified" : service.complete ? "Recorded" : "Partial"),
      value: service ? withEvidence(service.value, service.source || "Source not recorded") : MISSING },
    { label: "Street-frontage hosting", key: frontage?.value, source: frontage?.source,
      value: frontage ? withEvidence(frontage.value, frontage.source || "Source not recorded") : MISSING },
  ];
}

export function dealRows(deal: DealProps, sites: SiteProps[], signedIn: boolean): CompareRow[] {
  const linked = sites.find((site) => site.site_id === deal.universe_id);
  const cash = cashTile(deal);
  const trade = tradeAreaLines(deal);
  const population = trade.find((line) => line.startsWith("3-mile population "));
  const washes = trade.find((line) => line.startsWith("Washes "));
  const spare = spareLandSqft(deal.open_land_sqft, linked?.spare_ac_own, deal.open_land_basis);
  const cashBasis = basisBadge(deal.earnings_basis) || basisBadge(cash.basis);
  const cashValue = cash.hidden ? "" : deal.stated_cash_flow == null && !deal.stated_cash_flow_display ? (deal.figures_status === "withheld" ? cash.value : "") : [cash.value, cash.note, deal.earnings_period, cashBasis].filter(Boolean).join(" · ");
  return [
    { label: "Service area", value: shown(serviceAreaLabel(deal) || serviceAreaLabel(linked)) },
    { label: "Address", value: shown(displayAddress(deal.address)) },
    { label: "Stage", value: shown(stageDetail(deal.stage, deal.stage_group)) },
    ...(signedIn ? [{ label: "NDA", key: deal.nda_status || (deal.nda_id ? "Unknown" : "Not required"), value: ndaChip(deal) }] : []),
    ...(deal.suggested_drop && deal.stage_group !== "dropped" ? [{ label: "Suggested drop", key: "Proposed", value: deal.suggested_drop }] : []),
    { label: "Asking", key: signedIn ? deal.asking_price ?? deal.asking_price_display : null, value: signedIn ? withEvidence(sheetMoney(deal.asking_price, deal.asking_price_display), shownPriceSource(deal)) : MISSING },
    { label: "Bays that fit", value: deal.bays_that_fit != null ? String(Math.round(deal.bays_that_fit)) : MISSING },
    { label: "Traffic", key: deal.trade_aadt, value: shown(workbookTrafficLine(deal)) },
    { label: "Land", key: deal.land_acres, value: shown(acresText(deal.land_acres)) },
    { label: "Open land", value: spare.value },
    { label: "Land measurement", value: shown(spare.note) },
    ...(signedIn ? powerRows(deal, linked) : []),
    { label: "Power", value: powerSummary(factsForDeal(deal)) || "—" },
    { label: "3-mile population", value: population ? population.replace("3-mile population ", "") : MISSING },
    { label: "Washes", value: washes ? washes.replace(/^Washes /, "") : MISSING },
    { label: "Depot", value: depotLine(deal.miles_to_depot) },
    { label: "Zoning", value: shown(linked?.zoning) },
    { label: "Property owner", value: shown(linked?.owner) },
    ...(signedIn ? purchaseRows(deal) : []),
    ...decisionRows(deal, signedIn),
    ...ebitdaRows(deal, signedIn),
    { label: "Cash flow", key: signedIn && !cash.hidden ? deal.stated_cash_flow ?? deal.stated_cash_flow_display : null, basis: earningsBasis(deal), value: signedIn && cash.hidden ? "Not applicable" : signedIn ? shown(cashValue) : MISSING },
    { label: "Per acre", value: signedIn && deal.price_per_acre != null ? sheetMoney(deal.price_per_acre, fullMoney(deal.price_per_acre)) : "—" },
    ...pricingRows(deal, signedIn),
  ];
}

function pricingRows(deal: DealProps, signedIn: boolean): CompareRow[] {
  if (!signedIn) return [];
  if (deal.kind === "land") return [
    {label:"Savings versus hub", value:shown(deal.saving_vs_hub), source:"Workbook screening price comparison"},
    ...["Revenue", "Asking / earnings", "Implied business price", "Business-only multiple"].map(label => ({label,value:"Not applicable"})),
    {label:"Land estimate",value:sheetMoney(deal.land_estimate,deal.land_estimate_display), key:deal.land_estimate ?? deal.land_estimate_display},
  ];
  const operating = !cashTile(deal).hidden;
  const denominator = deal.earnings_multiple_which || deal.cash_flow_label || "cash flow";
  const earnings = "Asking / " + denominator;
  const multiple = deal.business_multiple_display && deal.business_multiple_display !== MISSING
    ? deal.business_multiple_display : deal.business_multiple != null ? deal.business_multiple.toFixed(1) + "x" : MISSING;
  const land = deal.land_estimate;
  const asking = deal.asking_price;
  const split = asking != null && asking > 0 && land != null
    ? `Land ${Math.round((Math.max(0, Math.min(land, asking)) / asking) * 100)}% · Business ${Math.round((Math.max(0, asking - land) / asking) * 100)}%`
    : "—";
  return [
    { label: "Pricing", value: split },
    { label: "Revenue", basis: [deal.revenue_period, deal.revenue_basis].map(value=>value?.trim().toLowerCase() || "").join("|"), key: deal.stated_revenue ?? deal.stated_revenue_display, value: !operating ? "Not applicable" : signedIn ? withEvidence(deal.stated_revenue_display || (deal.stated_revenue != null ? fullMoney(deal.stated_revenue) : MISSING), deal.revenue_period, deal.revenue_basis, deal.figures_source) : "—" },
    { label: "Land estimate", key: deal.land_estimate ?? deal.land_estimate_display, value: deal.land_estimate_display ? `${deal.land_estimate_display} · Estimate` : deal.land_estimate != null ? fullMoney(deal.land_estimate) : (deal.land_estimate_reason || "—") },
    { label: "Implied business price", key: deal.business_value ?? deal.business_value_display,
      value: sheetMoney(deal.business_value, deal.business_value_display), source: "Asking less estimated land value" },
    { label: "Savings versus hub", value: shown(deal.saving_vs_hub), source: "Workbook screening price comparison" },
    { label: "County value (land + buildings)", key: deal.county_value ?? deal.county_value_display, value: deal.county_value_display || "—" },
    { label: "Asking / revenue", key: deal.revenue_multiple ?? deal.revenue_multiple_display, value: !operating ? "Not applicable" : deal.revenue_multiple_display && deal.revenue_multiple_display !== "—" ? [deal.revenue_multiple_display, deal.revenue_multiple_basis].filter(Boolean).join(" · ") : (deal.revenue_multiple_reason || "—") },
    { label: "Asking / earnings", basis: earningsBasis(deal), key: deal.earnings_multiple ?? deal.earnings_multiple_display, value: !operating ? "Not applicable" : deal.earnings_multiple_display && deal.earnings_multiple_display !== "—" ? [deal.earnings_multiple_display, earnings, deal.earnings_period, deal.earnings_multiple_basis].filter(Boolean).join(" · ") : (deal.earnings_multiple_reason || "—") },
    { label: "Business-only multiple", key: deal.business_multiple ?? deal.business_multiple_display, basis: earningsBasis(deal),
      source: [deal.land_estimate_tip, deal.figures_source].filter(Boolean).join(" · "),
      value: !operating || deal.pricing_eligible === false ? "Not applicable" : withEvidence(multiple, denominator, deal.earnings_period, deal.business_multiple_basis) },
  ];
}

export function siteRows(site: SiteProps, deals: DealProps[], signedIn: boolean): CompareRow[] {
  const linked = deals.find((deal) => deal.universe_id === site.site_id || deal.deal_id === site.linked_deal_id);
  const acres = site.parcel_acres != null ? `${site.parcel_acres} ac` : site.lot_ac != null ? `${site.lot_ac} ac` : "";
  const spare = spareLandSqft(linked?.open_land_sqft, site.spare_ac_own, linked?.open_land_basis);
  const cash = linked ? cashTile(linked) : null;
  const cashBasis = linked ? (basisBadge(linked.earnings_basis) || basisBadge(cash?.basis)) : "";
  const cashValue = cash && !cash.hidden && (linked?.stated_cash_flow != null || linked?.stated_cash_flow_display) ? [cash.value, cash.note, linked?.earnings_period, cashBasis].filter(Boolean).join(" · ") : linked?.figures_status === "withheld" ? cash?.value : "";
  return [
    { label: "Service area", value: shown(serviceAreaLabel(site)) },
    { label: "Address", value: shown(displayAddress(site.address)) },
    { label: "Stage", value: shown(site.pipeline_stage || "Universe") },
    ...(signedIn && linked ? [{ label: "NDA", key: linked.nda_status || (linked.nda_id ? "Unknown" : "Not required"), value: ndaChip(linked) }] : []),
    { label: "Asking", key: signedIn ? site.asking_price ?? site.asking_price_display : null, value: signedIn ? withEvidence(sheetMoney(site.asking_price, site.asking_price_display), site.asking_price_source) : MISSING },
    { label: "Bays that fit", value: linked?.bays_that_fit != null ? String(Math.round(linked.bays_that_fit)) : MISSING },
    { label: "Traffic", key: site.aadt_count?.replaceAll(",", ""), value: shown(universeTrafficLine(site)) },
    { label: "Land", key: site.parcel_acres ?? site.lot_ac, value: shown(acres) },
    { label: "Open land", value: spare.value },
    { label: "Land measurement", value: shown(spare.note) },
    ...(signedIn ? powerRows(linked, site) : []),
    { label: "Power", value: powerSummary(factsForSite(site, linked)) || "—" },
    { label: "3-mile population", value: linked?.trade_population != null ? Math.round(linked.trade_population).toLocaleString() : MISSING },
    { label: "Washes", value: linked && (linked.trade_washes_1mi != null || linked.trade_washes_3mi != null) ? [linked.trade_washes_1mi != null ? `${linked.trade_washes_1mi} within 1 mile` : "", linked.trade_washes_3mi != null ? `${linked.trade_washes_3mi} within 3 miles` : ""].filter(Boolean).join(" · ") : MISSING },
    { label: "Depot", value: depotLine(site.miles_to_depot) },
    { label: "Zoning", value: shown(site.zoning) },
    { label: "Property owner", value: shown(site.owner) },
    ...(signedIn && linked ? purchaseRows(linked) : []),
    ...decisionRows(linked, signedIn),
    ...(signedIn && !linked && site.land_only ? [{label:"EBITDA",value:"Not applicable"}] : ebitdaRows(linked, signedIn)),
    ...(signedIn && !linked ? ["Revenue","Asking / earnings","Implied business price","Business-only multiple","Savings versus hub","Land estimate","NDA","Blocker","Next check","Figure basis","Reporting period","Financial source"].map(label=>({label,value:site.land_only && ["Revenue","Asking / earnings","Implied business price","Business-only multiple","Figure basis","Reporting period","Financial source"].includes(label) ? "Not applicable" : MISSING})) : []),
    { label: "Cash flow", key: signedIn && cash && !cash.hidden ? linked?.stated_cash_flow ?? linked?.stated_cash_flow_display : null, basis: earningsBasis(linked), value: signedIn && (cash?.hidden || (!linked && site.land_only)) ? "Not applicable" : signedIn ? shown(cashValue) : MISSING },
    { label: "Per acre", value: signedIn && linked?.price_per_acre != null ? sheetMoney(linked.price_per_acre, fullMoney(linked.price_per_acre)) : "—" },
    ...(linked ? pricingRows(linked, signedIn) : []),
  ];
}


function ebitdaRows(deal: DealProps | undefined, signedIn: boolean): CompareRow[] {
  if (!signedIn) return [];
  if (deal && cashTile(deal).hidden) return [{label:"EBITDA",value:"Not applicable"}];
  if (!deal || !/\bebitda\b/i.test(deal.cash_flow_label || "")) return [{label:"EBITDA",value:MISSING}];
  const amount = deal.stated_cash_flow_display || (deal.stated_cash_flow != null ? fullMoney(deal.stated_cash_flow) : MISSING);
  return [{label:"EBITDA",key:deal.stated_cash_flow ?? deal.stated_cash_flow_display, basis:earningsBasis(deal),
    value:withEvidence(amount,deal.cash_flow_label,deal.earnings_basis,deal.earnings_period,deal.figures_source)}];
}

function earningsBasis(deal?: DealProps) {
  return [deal?.cash_flow_label?.trim(), deal?.earnings_period?.trim(), deal?.earnings_basis?.trim()].join("|").toLowerCase();
}

function decisionRows(deal: DealProps | undefined, signedIn: boolean): CompareRow[] {
  if (!deal || !signedIn) return [];
  const applicable = deal.kind !== "land" && deal.financials_open !== false && deal.figures_status !== "vacant";
  return [
    { label: "Financial source", value: applicable ? shown(deal.figures_source) : "Not applicable" },
    { label: "Financial package", value: applicable ? shown(packageLine(deal) || deal.package_status) : "Not applicable" },
    { label: "Cash flow coverage", value: !applicable ? "Not applicable" : deal.stated_cash_flow != null || deal.stated_cash_flow_display ? "Reported" : cashTile(deal).value },
    { label: "Figure basis", value: applicable ? shown(deal.earnings_basis || deal.figures_basis) : "Not applicable" },
    { label: "Reporting period", value: applicable ? shown(deal.earnings_period || deal.revenue_period) : "Not applicable" },
    { label: "Blocker", key: deal.stage_blocker === MISSING ? "clear" : deal.stage_blocker?.trim() ? "blocked" : null, value: deal.stage_blocker === MISSING ? "No blocker recorded" : shown(deal.stage_blocker) },
    { label: "Next check", value: shown(deal.next_step) },
  ];
}

function comparisonKey(row?: CompareRow) {
  if (!row) return "";
  const raw = "key" in row ? row.key : row.value;
  const value = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return ["", "—", "-", "unknown", "not on file"].includes(value) ? "" : value;
}

export function comparisonMeasures(columns: ComparisonColumn[]) {
  const labels = new Set(columns.flatMap(column => column.rows.map(row => row.label)));
  return Array.from(labels, label => {
    const cells = columns.map(column => column.rows.find(row => row.label === label));
    const values = cells.map(cell => cell?.value && cell.value !== "Not on file" ? cell.value : MISSING);
    const recorded = cells.filter(cell => cell && ![MISSING, "Not applicable", "Checking…", "Unavailable"].includes(cell.value) && comparisonKey(cell));
    const available = recorded.length;
    const keys = recorded.map(comparisonKey);
    const missing = values.filter(value => value === MISSING).length;
    const section = sectionFor(label);
    const differentBasis = new Set(recorded.map(cell => cell?.basis?.trim().toLowerCase() || "")).size > 1;
    const kind = section === "Record details" || label === "Next check" ? "detail"
      : differentBasis ? "basis"
      : available && missing ? "gap"
      : !available ? "empty"
      : new Set(keys).size > 1 ? "different" : "shared";
    return { label, values, section, kind, available, missing, allMissing: missing > 0 && values.every(value => value === MISSING || value === "Not applicable"), partial: available > 0 && missing > 0 };
  });
}

/** The measure stays in the URL while the reviewer inspects the underlying record. */
export const numberEvidence: Record<string, string> = {
  Asking: "asking", Land: "land", "Open land": "open-land", "Land measurement": "open-land",
  "On-site service": "on-site-service", "Street-frontage hosting": "street-hosting", Power: "power", Traffic: "traffic", Zoning: "zoning", "Per acre": "per-acre",
  EBITDA: "cash-flow", Revenue: "revenue", "Cash flow": "cash-flow", "Cash flow coverage": "cash-flow",
};
