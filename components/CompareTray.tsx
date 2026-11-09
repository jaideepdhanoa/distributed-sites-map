import type { CSSProperties, ReactNode } from "react";
import type { DealProps, SiteProps } from "@/lib/types";
import { displayAddress } from "@/lib/format";
import { acreUnit, acresText, capacitySummary, cashTile, depotLine, factsForDeal, factsForSite, fullMoney, openLandText, sheetMoney, tradeAreaLines, universeTrafficLine, workbookTrafficLine } from "@/lib/keyNumbers";
import { stageDetail } from "@/lib/labels";

const MISSING = "Not on file";

type CompareRow = { label: string; value: string };

function shown(value?: string | null) {
  const text = (value || "").trim();
  return text || MISSING;
}

function dealRows(deal: DealProps, sites: SiteProps[]): CompareRow[] {
  const linked = sites.find((site) => site.site_id === deal.universe_id);
  const cash = cashTile(deal);
  const trade = tradeAreaLines(deal);
  const population = trade.find((line) => line.startsWith("3-mile population "));
  const washes = trade.find((line) => line.startsWith("Washes "));
  const spare = [
    deal.open_land_sqft != null ? `${openLandText(deal.open_land_sqft)} sheet` : "",
    linked && linked.spare_ac_own != null ? `${acreUnit(linked.spare_ac_own, linked.spare_ac_own_text)} census` : "",
  ].filter(Boolean).join(" · ");
  const cashValue = cash.hidden ? "" : [cash.value, cash.note, cash.basis].filter(Boolean).join(" · ");
  return [
    { label: "Address", value: shown(displayAddress(deal.address)) },
    { label: "Stage", value: shown(stageDetail(deal.stage, deal.stage_group)) },
    { label: "Asking", value: sheetMoney(deal.asking_price, deal.asking_price_display) },
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
    { label: "Cash flow", value: shown(cashValue) },
    { label: "Per acre", value: deal.price_per_acre != null ? sheetMoney(deal.price_per_acre, fullMoney(deal.price_per_acre)) : MISSING },
  ];
}

function siteRows(site: SiteProps, deals: DealProps[]): CompareRow[] {
  const linked = deals.find((deal) => deal.universe_id === site.site_id || deal.deal_id === site.linked_deal_id);
  const acres = site.parcel_acres != null ? `${site.parcel_acres} ac` : site.lot_ac != null ? `${site.lot_ac} ac` : "";
  const spare = site.spare_ac_own != null ? `${acreUnit(site.spare_ac_own, site.spare_ac_own_text)} census` : "";
  const cash = linked ? cashTile(linked) : null;
  const cashValue = cash && !cash.hidden ? [cash.value, cash.note, cash.basis].filter(Boolean).join(" · ") : "";
  return [
    { label: "Address", value: shown(displayAddress(site.address)) },
    { label: "Stage", value: shown(site.pipeline_stage || "Universe") },
    { label: "Asking", value: shown(site.asking_price_display) },
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
    { label: "Cash flow", value: shown(cashValue) },
    { label: "Per acre", value: linked?.price_per_acre != null ? sheetMoney(linked.price_per_acre, fullMoney(linked.price_per_acre)) : MISSING },
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
}: {
  deals: DealProps[];
  sites: SiteProps[];
  contextSites?: SiteProps[];
  onRemove: (id: string) => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const lookup = contextSites || sites;
  const count = deals.length + sites.length;
  if (!count) return null;
  return (
    <aside className="compare-tray" data-testid="compare-tray">
      <div className="compare-bar">
        <strong>Compare</strong>
        {deals.map((deal) => (
          <button key={deal.deal_id} type="button" onClick={() => onRemove(deal.deal_id)}>
            {deal.name || deal.address}
            <span aria-hidden="true"> ×</span>
          </button>
        ))}
        {sites.map((site) => (
          <button key={site.site_id} type="button" onClick={() => onRemove(site.site_id)}>
            {site.name || site.address}
            <span aria-hidden="true"> ×</span>
          </button>
        ))}
        <button type="button" className="compare-go" disabled={count < 2}>
          Compare {count}
        </button>
        <button type="button" className="compare-dismiss paper-btn" onClick={onClose}>Close compare</button>
        {children}
      </div>
      {count >= 2 ? (
        <div className="compare-grid" style={{ "--compare-cols": String(count) } as CSSProperties}>
          {deals.map((deal) => (
            <CompareCard key={deal.deal_id} title={deal.name || displayAddress(deal.address) || deal.deal_id} rows={dealRows(deal, lookup)} />
          ))}
          {sites.map((site) => (
            <CompareCard key={site.site_id} title={site.name || displayAddress(site.address) || site.site_id} rows={siteRows(site, deals)} />
          ))}
        </div>
      ) : null}
    </aside>
  );
}
