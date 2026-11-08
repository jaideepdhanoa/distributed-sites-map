import type { ReactNode } from "react";
import type { DealProps, SiteProps } from "@/lib/types";
import { acreUnit, acresText, baysLine, capacitySummary, cashTile, depotLine, displayScore, factsForDeal, fullMoney, openLandText, sheetMoney, tradeAreaLines, universeTrafficLine, workbookTrafficLine } from "@/lib/keyNumbers";
import { stageDetail } from "@/lib/labels";

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
        <button type="button" className="compare-dismiss" onClick={onClose}>Close compare</button>
        {children}
      </div>
      {count >= 2 ? (
        <div className="compare-grid">
          {deals.map((deal) => {
            const cash = cashTile(deal);
            return (
              <article key={deal.deal_id}>
                <h3>{deal.name || deal.address}</h3>
                <p>{stageDetail(deal.stage, deal.stage_group)}</p>
                <p>Asking {sheetMoney(deal.asking_price, deal.asking_price_display)}</p>
                <p>{baysLine(deal) || "Bays that fit not provided"}</p>
                <p>{workbookTrafficLine(deal) || "Traffic count not provided"}</p>
                {cash.hidden ? null : <p>Cash flow {deal.stated_cash_flow_display ? sheetMoney(deal.stated_cash_flow, deal.stated_cash_flow_display) : cash.value}{cash.note ? ` · ${cash.note}` : ""}{cash.basis ? ` · ${cash.basis}` : ""}</p>}
                <p>Land {acresText(deal.land_acres) || "Not provided"}</p>
                <p>Per acre {deal.price_per_acre != null ? sheetMoney(deal.price_per_acre, fullMoney(deal.price_per_acre)) : "Not provided"}</p>
                <p>Workbook spare {deal.open_land_sqft != null ? `${openLandText(deal.open_land_sqft)} · sheet, square feet` : "Not measured"}</p>
                {(() => {
                  const linked = lookup.find((site) => site.site_id === deal.universe_id);
                  if (!linked || linked.spare_ac_own == null) return null;
                  return <p>Universe own spare {acreUnit(linked.spare_ac_own, linked.spare_ac_own_text)} · census own-parcel, acres</p>;
                })()}
                <p>Site capacity {capacitySummary(factsForDeal(deal))}</p>
                {tradeAreaLines(deal).map((line) => <p key={line}>{line}</p>)}
                {deal.access_notes ? <p>Access and visibility: {deal.access_notes}</p> : null}
                {displayScore(deal.score) ? <p>Score {displayScore(deal.score)} of 100</p> : null}
                <p>Depot {depotLine(deal.miles_to_depot, deal.miles_to_depot != null)}</p>
              </article>
            );
          })}
          {sites.map((site) => (
            <article key={site.site_id}>
              <h3>{site.name || site.address}</h3>
              <p>{site.address}</p>
              <p>{site.owner || "Owner not on file"}</p>
              <p>{site.zoning || "Zoning not on file"}</p>
              <p>{universeTrafficLine(site) || "Traffic count not on the universe row"}</p>
            </article>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
