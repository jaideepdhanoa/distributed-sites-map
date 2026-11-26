import { currentScreen } from "./selection/screen";
import { cashTile, sheetMoney, acresText, spareLandSqft, universeTrafficLine, workbookTrafficLine } from "./keyNumbers";
import { nextStepText, stageTitle, statusOf } from "./labels";
import type { DealProps, SiteProps, UnscreenedProps } from "./types";

type RecordInput = {
  site?: SiteProps | null;
  deal?: DealProps | null;
  listing?: UnscreenedProps | null;
  signedIn: boolean;
};

type Figure = { label: string; value: string; source: string; date: string };
type Evidence = { kind: "county"; href: string } | { kind: "space" } | {kind:"layout"} | { kind: "financials"; id: string };

function present(value?: string | null) {
  const text = value?.trim();
  return text && !/^(—|-|unknown|not on file|n\/a)$/i.test(text) ? text : "";
}

function countyLink(value?: string) {
  try {
    const url = new URL(value || "");
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

export function screeningEvidence({ site, deal, listing, signedIn }: RecordInput) {
  const spare = spareLandSqft(deal?.open_land_sqft, site?.spare_ac_own, deal?.open_land_basis);
  const figures: Figure[] = [];
  function add(label: string, value?: string | null, source?: string, date?: string) {
    const text = present(value);
    if (text) figures.push({ label, value: text, source: present(source), date: present(date) });
  }
  const screen = signedIn && deal?.screening && deal.stage_group !== "dropped" ? currentScreen(deal.screening, deal) : undefined;
  if (screen?.fit) add("Assessed layout",screen.fit,"Space assessment");
  if (deal?.bays_that_fit != null) add("Earlier workbook bays", String(deal.bays_that_fit), "Pipeline workbook");
  add("Open land", spare.value, spare.note);
  if (deal?.trade_aadt != null) add("Traffic", workbookTrafficLine(deal).replace(/ · Workbook trade area$/, ""), "Workbook trade area");
  else if (site?.aadt_count) add("Traffic", universeTrafficLine({ ...site, aadt_year: "" }), site.aadt_source, site.aadt_year);
  if (deal?.land_acres != null) add("Parcel size", acresText(deal.land_acres), ["Pipeline workbook", present(deal.land_acres_basis)].filter(Boolean).join(" · "));
  else if (site?.parcel_acres != null) add("Parcel size", acresText(site.parcel_acres), site.assessor_source);
  else if (site?.lot_ac != null) add("Parcel size", acresText(site.lot_ac), site.lot_ac_source);
  else if (listing) add("Parcel size", acresText(listing.acres), "Listing");
  if (signedIn) {
    if (deal && (present(deal.asking_price_display) || deal.asking_price != null)) add("Asking price", sheetMoney(deal.asking_price,deal.asking_price_display), deal.asking_price_source);
    else if (site && (present(site.asking_price_display) || site.asking_price != null)) add("Asking price", sheetMoney(site.asking_price,site.asking_price_display), site.asking_price_source, site.asking_price_date);
    else add("Asking price", listing?.asking_price_display, listing?.asking_price_source);
  }
  if (signedIn && deal && deal.kind !== "land" && deal.financials_open !== false) {
    const cash = cashTile(deal);
    if (!cash.hidden && (deal.stated_cash_flow != null || present(deal.stated_cash_flow_display))) {
      add(deal.cash_flow_label || "Cash flow", cash.value, [deal.earnings_basis || cash.basis, deal.figures_source].filter(Boolean).join(" · "), deal.earnings_period);
    }
  }
  const status = deal ? stageTitle(deal.stage_group) : site ? statusOf(site).label : "Unscreened listing";
  const reason = (signedIn && present(deal?.decision_reason)) || present(site?.summary_why);
  const gap = signedIn ? present(deal?.stage_blocker) || present(deal?.next_step) : "";
  const county = countyLink(site?.county_url);
  let review = screen?.instruction || gap;
  let check: "county" | "space" | "financials" | undefined;
  let evidence: Evidence | undefined;
  let missing = "";
  if (deal?.stage_group === "dropped") review = "No further review scheduled.";
  else if (screen) review = screen.instruction;
  else if (!gap && signedIn && deal && (deal.stage_group === "financial" || deal.stage_group === "contacted") && deal.kind !== "land" && deal.financials_open !== false) review = "Review the financial statement.";
  else if (!gap && site?.verdict) review = nextStepText(site);
  else if (!gap && listing?.approximate) review = "Confirm the exact location.";
  else if (!gap && site && !deal) review = "Check the county parcel record.";
  else if (!gap && deal?.kind === "pipeline") review = "Check a parcel-matched layout for retained operations, parking and convertible bays.";
  else if (!gap && !present(spare.value)) review = "Confirm how much open land is usable.";
  else if (!gap && present(spare.value)) review = "Verify the usable open land.";
  if (screen?.layoutCheck || review.startsWith("Check a parcel-matched layout")) evidence = { kind:"layout" };
  else if (/county|parcel record|assessor|\bapn\b/i.test(review)) {
    check = "county";
    if (present(site?.apn)) add("Parcel number", site?.apn, site?.fields?.apn?.source || "Site record", site?.fields?.apn?.date);
    if (county) evidence = { kind: "county", href: county };
    else missing = "County record link not on file.";
  } else if (/open land|usable land|spare land|usable space|bay fit/i.test(review)) {
    check = "space";
    if (present(spare.value) && (site || deal)) evidence = { kind: "space" };
    else missing = "Open-land measurement not on file.";
  } else if (signedIn && deal && deal.kind !== "land" && deal.financials_open !== false && /financial|p\s*&\s*l|cash flow|revenue|profit and loss/i.test(review)) {
    check = "financials";
    evidence = { kind: "financials", id: deal.deal_id };
  }
  const preferred = check === "space" ? "Open land" : check === "county" ? "Parcel number" : "";
  const first = figures.findIndex(figure => figure.label === preferred);
  if (first > 0) figures.unshift(figures.splice(first, 1)[0]);
  return { status, origin:screen?.origin || (gap ? "Recorded check" : "Suggested check"), reason: /^not screened yet[.]?$/i.test(reason || "") ? "" : reason, figures, check, evidence, missing, review: review || "Review the site evidence." };
}

export function previewFitFigure(figures: ReturnType<typeof screeningEvidence>["figures"]) {
  return ["Assessed layout", "Open land", "Earlier workbook bays", "Parcel size", "Traffic"]
    .map(label => figures.find(figure => figure.label === label)).find(Boolean)
    || figures.find(figure => figure.label !== "Parcel number");
}
