import type { CSSProperties, ReactNode } from "react";
import type { DealProps, SiteProps } from "@/lib/types";
import { displayAddress } from "@/lib/format";
import { acreUnit, acresText, capacitySummary, cashTile, depotLine, factsForDeal, factsForSite, fullMoney, openLandText, sheetMoney, tradeAreaLines, universeTrafficLine, workbookTrafficLine } from "@/lib/keyNumbers";
import { basisBadge } from "@/lib/pricing";
import { stageDetail } from "@/lib/labels";
import { cardNdaLabel } from "@/lib/nda";

const MISSING = "Not on file";

type CompareRow = { label: string; value: string };

function shown(value?: string | null) {
  const text = (value || "").trim();
  return text || MISSING;
}

function dealRows(deal: DealProps, sites: SiteProps[], signedIn: boolean): CompareRow[] {
  const linked = sites.find((site) => site.site_id === deal.universe_id);
  const cash = cashTile(deal);
  const trade = tradeAreaLines(deal);
  const population = trade.find((line) => line.startsWith("3-mile population "));
  const washes = trade.find((line) => line.startsWith("Washes "));
  const spare = [
    deal.open_land_sqft != null ? `${openLandText(deal.open_land_sqft)} sheet` : "",
    linked && linked.spare_ac_own != null ? `${acreUnit(linked.spare_ac_own, linked.spare_ac_own_text)} census` : "",
  ].filter(Boolean).join(" · ");
  const cashBasis = basisBadge(deal.earnings_basis) || basisBadge(cash.basis);
  const cashValue = cash.hidden ? "" : [cash.value, cash.note, cashBasis].filter(Boolean).join(" · ");
  return [
    { label: "Address", value: shown(displayAddress(deal.address)) },
    { label: "Stage", value: shown(stageDetail(deal.stage, deal.stage_group)) },
    ...(cardNdaLabel(deal, signedIn) ? [{ label: "NDA", value: cardNdaLabel(deal, signedIn) }] : []),
    ...(deal.suggested_drop && deal.stage_group !== "dropped" ? [{ label: "Suggested drop", value: deal.suggested_drop }] : []),
    { label: "Asking", value: signedIn ? sheetMoney(deal.asking_price, deal.asking_price_display) : "—" },
    { label: "Bays that fit", value: deal.bays_that_fit != null ? String(Math.round(deal.bays_that_fit)) : MISSING },
    { label: "Traffic", value: shown(workbookTrafficLine(deal)) },
    { label: "Land", value: shown(acresText(deal.land_acres)) },
    { label: "Spare land", value: shown(spare) },
    { label: "Site capacity", value: capacitySummary(factsForDeal(deal)) },
    { label: "3-mile population", value: population ? population.replace("3-mile population ", "") : MISSING },
    { label: "Washes", value: washes ? washes.replace(/^Washes /, "") : MISSING },
    { label: "Depot", value: depotLine(deal.miles_to_depot, deal.miles_to_depot != null) },
    { label: "Zoning", value: shown(linked?.zoning) },
    { label: "Owner", value: shown(linked?.owner) },
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
    { label: "Revenue", value: signedIn ? [deal.stated_revenue_display || "—", deal.revenue_basis].filter(Boolean).join(" · ") : "—" },
    { label: "Land estimate", value: [deal.land_estimate_display || "—", land != null ? "Estimate" : ""].filter(Boolean).join(" · ") },
    { label: "Business value", value: deal.business_value_display || "—" },
    { label: "County value (land + buildings)", value: [deal.county_value_display || "—", deal.county_value_basis].filter(Boolean).join(" · ") },
    { label: "Asking / revenue", value: [deal.revenue_multiple_display || "—", deal.revenue_multiple_basis].filter(Boolean).join(" · ") },
    { label: earnings, value: [deal.earnings_multiple_display || "—", deal.earnings_multiple_basis].filter(Boolean).join(" · ") },
    { label: "Business-only multiple", value: [deal.business_multiple_display || "—", deal.business_multiple_basis].filter(Boolean).join(" · ") },
  ];
}

function siteRows(site: SiteProps, deals: DealProps[], signedIn: boolean): CompareRow[] {
  const linked = deals.find((deal) => deal.universe_id === site.site_id || deal.deal_id === site.linked_deal_id);
  const acres = site.parcel_acres != null ? `${site.parcel_acres} ac` : site.lot_ac != null ? `${site.lot_ac} ac` : "";
  const spare = site.spare_ac_own != null ? `${acreUnit(site.spare_ac_own, site.spare_ac_own_text)} census` : "";
  const cash = linked ? cashTile(linked) : null;
  const cashBasis = linked ? (basisBadge(linked.earnings_basis) || basisBadge(cash?.basis)) : "";
  const cashValue = cash && !cash.hidden ? [cash.value, cash.note, cashBasis].filter(Boolean).join(" · ") : "";
  return [
    { label: "Address", value: shown(displayAddress(site.address)) },
    { label: "Stage", value: shown(site.pipeline_stage || "Universe") },
    ...(linked && cardNdaLabel(linked, signedIn) ? [{ label: "NDA", value: cardNdaLabel(linked, signedIn) }] : []),
    { label: "Asking", value: signedIn ? shown(site.asking_price_display) : "—" },
    { label: "Bays that fit", value: linked?.bays_that_fit != null ? String(Math.round(linked.bays_that_fit)) : MISSING },
    { label: "Traffic", value: shown(universeTrafficLine(site)) },
    { label: "Land", value: shown(acres) },
    { label: "Spare land", value: shown(spare) },
    { label: "Site capacity", value: capacitySummary(factsForSite(site, linked)) },
    { label: "3-mile population", value: linked?.trade_population != null ? Math.round(linked.trade_population).toLocaleString() : MISSING },
    { label: "Washes", value: linked && (linked.trade_washes_1mi != null || linked.trade_washes_3mi != null) ? [linked.trade_washes_1mi != null ? `${linked.trade_washes_1mi} within 1 mile` : "", linked.trade_washes_3mi != null ? `${linked.trade_washes_3mi} within 3 miles` : ""].filter(Boolean).join(" · ") : MISSING },
    { label: "Depot", value: depotLine(site.miles_to_depot, site.miles_to_depot != null) },
    { label: "Zoning", value: shown(site.zoning) },
    { label: "Owner", value: shown(site.owner) },
    { label: "Cash flow", value: signedIn ? shown(cashValue) : "—" },
    { label: "Per acre", value: signedIn && linked?.price_per_acre != null ? sheetMoney(linked.price_per_acre, fullMoney(linked.price_per_acre)) : "—" },
    ...(linked ? pricingRows(linked, signedIn) : []),
  ];
}

function CompareCard({ title, rows }: { title: string; rows: CompareRow[] }) {
  return (
    <article style={{ gridRow: `span ${rows.length + 1}` }}>
      <h3>{title}</h3>
      {rows.map((row) => (
        <p key={row.label} data-compare-row={row.label}>
          <span>{row.label}</span>
          <strong>{row.value}</strong>
        </p>
      ))}
    </article>
  );
}

export default function CompareTray({
  deals,
  sites,
  contextSites,
  onRemove,
  onClose,
  children,
  signedIn = false,
}: {
  deals: DealProps[];
  sites: SiteProps[];
  contextSites?: SiteProps[];
  onRemove: (id: string) => void;
  onClose: () => void;
  children?: ReactNode;
  signedIn?: boolean;
}) {
  const lookup = contextSites || sites;
  const count = deals.length + sites.length;
  if (!count) return null;
  return (
    <aside className="compare-tray" data-testid="compare-tray">
      <div className="compare-bar">
        <strong>Compare</strong>
        {deals.map((deal) => (
          <button key={deal.deal_id} type="button" onClick={() => onRemove(deal.deal_id)} className="menu-item">
            {deal.name || deal.address}
            <span aria-hidden="true"> ×</span>
          </button>
        ))}
        {sites.map((site) => (
          <button key={site.site_id} type="button" onClick={() => onRemove(site.site_id)} className="menu-item">
            {site.name || site.address}
            <span aria-hidden="true"> ×</span>
          </button>
        ))}
        <button type="button" className="compare-go" disabled={count < 2}>
          Compare {count}
        </button>
        <button type="button" className="close" aria-label="Close compare" onClick={onClose}><span aria-hidden="true">×</span></button>
        {children}
      </div>
      {count >= 2 ? (
        <div className="compare-grid" style={{ "--compare-cols": String(count) } as CSSProperties}>
          {deals.map((deal) => (
            <CompareCard key={deal.deal_id} title={deal.name || displayAddress(deal.address) || deal.deal_id} rows={dealRows(deal, lookup, signedIn)} />
          ))}
          {sites.map((site) => (
            <CompareCard key={site.site_id} title={site.name || displayAddress(site.address) || site.site_id} rows={siteRows(site, deals, signedIn)} />
          ))}
        </div>
      ) : null}
    </aside>
  );
}
