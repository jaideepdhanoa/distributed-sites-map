import { useEffect, useRef, type ReactNode } from "react";
import type { DealProps, SiteProps } from "@/lib/types";
import { displayAddress, shownPriceSource } from "@/lib/format";
import { acreUnit, acresText, cashTile, depotLine, factsForDeal, factsForSite, fullMoney, isOpenLandBlank, openLandLabel, powerSummary, sheetMoney, tradeAreaLines, universeTrafficLine, workbookTrafficLine } from "@/lib/keyNumbers";
import { basisBadge } from "@/lib/pricing";
import { stageDetail } from "@/lib/labels";
import { cardNdaLabel } from "@/lib/nda";

const MISSING = "—";

type CompareRow = { label: string; value: string };

const compareSections = ["Site fit", "Financials", "Diligence"] as const;
function sectionFor(label: string): typeof compareSections[number] {
  if (["Address", "Bays that fit", "Traffic", "Land", "Open land", "Power", "3-mile population", "Washes", "Depot", "Zoning"].includes(label)) return "Site fit";
  if (["Stage", "NDA", "Suggested drop", "Property owner"].includes(label)) return "Diligence";
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

function dealRows(deal: DealProps, sites: SiteProps[], signedIn: boolean): CompareRow[] {
  const linked = sites.find((site) => site.site_id === deal.universe_id);
  const cash = cashTile(deal);
  const trade = tradeAreaLines(deal);
  const population = trade.find((line) => line.startsWith("3-mile population "));
  const washes = trade.find((line) => line.startsWith("Washes "));
  const spare = [
    !isOpenLandBlank(openLandLabel(deal.open_land_sqft, deal.open_land_basis)) ? `${openLandLabel(deal.open_land_sqft, deal.open_land_basis)} sheet` : "",
    linked && linked.spare_ac_own != null ? `${acreUnit(linked.spare_ac_own, linked.spare_ac_own_text)} census` : "",
  ].filter(Boolean).join(" · ");
  const cashBasis = basisBadge(deal.earnings_basis) || basisBadge(cash.basis);
  const cashValue = cash.hidden ? "" : [cash.value, cash.note, deal.earnings_period, cashBasis].filter(Boolean).join(" · ");
  return [
    { label: "Address", value: shown(displayAddress(deal.address)) },
    { label: "Stage", value: shown(stageDetail(deal.stage, deal.stage_group)) },
    ...(cardNdaLabel(deal, signedIn) ? [{ label: "NDA", value: cardNdaLabel(deal, signedIn) }] : []),
    ...(deal.suggested_drop && deal.stage_group !== "dropped" ? [{ label: "Suggested drop", value: deal.suggested_drop }] : []),
    { label: "Asking", value: signedIn ? withEvidence(sheetMoney(deal.asking_price, deal.asking_price_display), shownPriceSource(deal)) : MISSING },
    { label: "Bays that fit", value: deal.bays_that_fit != null ? String(Math.round(deal.bays_that_fit)) : MISSING },
    { label: "Traffic", value: shown(workbookTrafficLine(deal)) },
    { label: "Land", value: shown(acresText(deal.land_acres)) },
    { label: "Open land", value: shown(spare) },
    { label: "Power", value: powerSummary(factsForDeal(deal)) || "—" },
    { label: "3-mile population", value: population ? population.replace("3-mile population ", "") : MISSING },
    { label: "Washes", value: washes ? washes.replace(/^Washes /, "") : MISSING },
    { label: "Depot", value: depotLine(deal.miles_to_depot, deal.miles_to_depot != null) },
    { label: "Zoning", value: shown(linked?.zoning) },
    { label: "Property owner", value: shown(linked?.owner) },
    { label: "Cash flow", value: signedIn ? shown(cashValue) : "—" },
    { label: "Per acre", value: signedIn && deal.price_per_acre != null ? sheetMoney(deal.price_per_acre, fullMoney(deal.price_per_acre)) : "—" },
    ...pricingRows(deal, signedIn),
  ];
}

function pricingRows(deal: DealProps, signedIn: boolean): CompareRow[] {
  if (!signedIn || deal.kind === "land") return [];
  const earnings = deal.earnings_multiple_which ? `Asking / ${deal.earnings_multiple_which}` : "Asking / cash flow";
  const land = deal.land_estimate;
  const asking = deal.asking_price;
  const split = asking != null && asking > 0 && land != null
    ? `Land ${Math.round((Math.max(0, Math.min(land, asking)) / asking) * 100)}% · Business ${Math.round((Math.max(0, asking - land) / asking) * 100)}%`
    : "—";
  return [
    { label: "Pricing", value: split },
    { label: "Revenue", value: signedIn ? withEvidence(deal.stated_revenue_display || MISSING, deal.revenue_period, deal.revenue_basis, deal.figures_source) : "—" },
    { label: "Land estimate", value: deal.land_estimate_display ? `${deal.land_estimate_display} · Estimate` : (deal.land_estimate_reason || "—") },
    { label: "Business value", value: deal.business_value_display || deal.business_value_reason || "—" },
    { label: "County value (land + buildings)", value: deal.county_value_display || "—" },
    { label: "Asking / revenue", value: deal.revenue_multiple_display && deal.revenue_multiple_display !== "—" ? [deal.revenue_multiple_display, deal.revenue_multiple_basis].filter(Boolean).join(" · ") : (deal.revenue_multiple_reason || "—") },
    { label: earnings, value: deal.earnings_multiple_display && deal.earnings_multiple_display !== "—" ? [deal.earnings_multiple_display, deal.earnings_multiple_basis].filter(Boolean).join(" · ") : (deal.earnings_multiple_reason || "—") },
    { label: "Business-only multiple", value: deal.business_multiple_display && deal.business_multiple_display !== "—" ? [deal.business_multiple_display, deal.business_multiple_basis].filter(Boolean).join(" · ") : (deal.business_multiple_reason || "—") },
  ];
}

function siteRows(site: SiteProps, deals: DealProps[], signedIn: boolean): CompareRow[] {
  const linked = deals.find((deal) => deal.universe_id === site.site_id || deal.deal_id === site.linked_deal_id);
  const acres = site.parcel_acres != null ? `${site.parcel_acres} ac` : site.lot_ac != null ? `${site.lot_ac} ac` : "";
  const spare = site.spare_ac_own != null ? `${acreUnit(site.spare_ac_own, site.spare_ac_own_text)} census` : "";
  const cash = linked ? cashTile(linked) : null;
  const cashBasis = linked ? (basisBadge(linked.earnings_basis) || basisBadge(cash?.basis)) : "";
  const cashValue = cash && !cash.hidden ? [cash.value, cash.note, linked?.earnings_period, cashBasis].filter(Boolean).join(" · ") : "";
  return [
    { label: "Address", value: shown(displayAddress(site.address)) },
    { label: "Stage", value: shown(site.pipeline_stage || "Universe") },
    ...(linked && cardNdaLabel(linked, signedIn) ? [{ label: "NDA", value: cardNdaLabel(linked, signedIn) }] : []),
    { label: "Asking", value: signedIn ? withEvidence(shown(site.asking_price_display), site.asking_price_source) : MISSING },
    { label: "Bays that fit", value: linked?.bays_that_fit != null ? String(Math.round(linked.bays_that_fit)) : MISSING },
    { label: "Traffic", value: shown(universeTrafficLine(site)) },
    { label: "Land", value: shown(acres) },
    { label: "Open land", value: shown(spare) },
    { label: "Power", value: powerSummary(factsForSite(site, linked)) || "—" },
    { label: "3-mile population", value: linked?.trade_population != null ? Math.round(linked.trade_population).toLocaleString() : MISSING },
    { label: "Washes", value: linked && (linked.trade_washes_1mi != null || linked.trade_washes_3mi != null) ? [linked.trade_washes_1mi != null ? `${linked.trade_washes_1mi} within 1 mile` : "", linked.trade_washes_3mi != null ? `${linked.trade_washes_3mi} within 3 miles` : ""].filter(Boolean).join(" · ") : MISSING },
    { label: "Depot", value: depotLine(site.miles_to_depot, site.miles_to_depot != null) },
    { label: "Zoning", value: shown(site.zoning) },
    { label: "Property owner", value: shown(site.owner) },
    { label: "Cash flow", value: signedIn ? shown(cashValue) : "—" },
    { label: "Per acre", value: signedIn && linked?.price_per_acre != null ? sheetMoney(linked.price_per_acre, fullMoney(linked.price_per_acre)) : "—" },
    ...(linked ? pricingRows(linked, signedIn) : []),
  ];
}

export default function CompareTray({
  deals,
  sites,
  contextSites,
  contextDeals,
  onRemove,
  onClose,
  children,
  signedIn = false,
}: {
  deals: DealProps[];
  sites: SiteProps[];
  contextSites?: SiteProps[];
  contextDeals?: DealProps[];
  onRemove: (id: string) => void;
  onClose: () => void;
  children?: ReactNode;
  signedIn?: boolean;
}) {
  const lookup = contextSites || sites;
  const count = deals.length + sites.length;
  const matrixRef = useRef<HTMLDivElement>(null);
  const hasMatrix = count >= 2;
  useEffect(() => {
    if (!hasMatrix) return;
    const trigger = document.activeElement;
    matrixRef.current?.focus({ preventScroll: true });
    return () => {
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [hasMatrix]);
  if (!count) return null;
  const columns = [
    ...deals.map(deal => ({ id: deal.deal_id, title: deal.name || displayAddress(deal.address) || deal.deal_id, rows: dealRows(deal, lookup, signedIn) })),
    ...sites.map(site => ({ id: site.site_id, title: site.name || displayAddress(site.address) || site.site_id, rows: siteRows(site, contextDeals || deals, signedIn) })),
  ];
  const measures = Array.from(new Set(columns.flatMap(column => column.rows.map(row => row.label))));
  return (
    <aside className="compare-tray" data-testid="compare-tray">
      <div className="compare-bar">
        <strong>Compare</strong>
        {deals.map((deal) => (
          <button key={deal.deal_id} type="button" aria-label={`Remove ${deal.name || deal.address} from comparison`} onClick={() => onRemove(deal.deal_id)} className="menu-item">
            {deal.name || deal.address}
            <span aria-hidden="true"> ×</span>
          </button>
        ))}
        {sites.map((site) => (
          <button key={site.site_id} type="button" aria-label={`Remove ${site.name || site.address} from comparison`} onClick={() => onRemove(site.site_id)} className="menu-item">
            {site.name || site.address}
            <span aria-hidden="true"> ×</span>
          </button>
        ))}
        <span className="layer-meta" role="status">{count} of 4 selected{count === 1 ? " · Select another site" : count === 4 ? " · Remove one to add another" : ""}</span>
        <button type="button" className="close" aria-label="Close compare" onClick={onClose}><span aria-hidden="true">×</span></button>
        {children}
      </div>
      {count >= 2 ? (
        <div className="comparison-scroll" ref={matrixRef} tabIndex={0} aria-label="Comparison facts">
          <table className="comparison-table">
            <caption className="sr">Site comparison</caption>
            <thead><tr><th scope="col">Measure</th>{columns.map(column => <th scope="col" key={column.id}>{column.title}</th>)}</tr></thead>
            {compareSections.map(section => (
              <tbody key={section} aria-label={section}>
                <tr className="comparison-section"><th scope="rowgroup" colSpan={columns.length + 1}>{section}</th></tr>
                {measures.filter(label => sectionFor(label) === section).map(label => (
              <tr key={label} data-compare-row={label}>
                <th scope="row">{label}</th>
                {columns.map(column => {
                  const value = column.rows.find(row => row.label === label)?.value;
                  return <td key={column.id}>{value && value !== "—" ? value : label === "Suggested drop" ? "None recorded" : "Not on file"}</td>;
                })}
              </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      ) : null}
    </aside>
  );
}
