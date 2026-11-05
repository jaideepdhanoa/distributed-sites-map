import type { DealProps } from "@/lib/types";
import { basisLabel, cashTile, checkedPhrase, depotLine, openLandText, peerNote } from "@/lib/keyNumbers";
import { shownPriceSource } from "@/lib/format";
import { stageDetail, stageTone } from "@/lib/labels";

export default function KeyStrip({
  deal,
  hasPin,
  peers,
}: {
  deal: DealProps;
  hasPin: boolean;
  peers: DealProps[];
}) {
  const tone = stageTone(deal);
  const rank = peerNote(deal, peers);
  const cash = cashTile(deal);
  const acres = deal.land_acres != null ? `${deal.land_acres} ac` : "Not provided";
  const open = deal.open_land_sqft != null ? openLandText(deal.open_land_sqft) : "Not measured";
  const perAcre = deal.price_per_acre_display || "Not provided";
  const asking = deal.asking_price_display || "Not provided";
  return (
    <section className="key-strip" data-testid="key-strip">
      <div className="metrics">
        <article>
          <span>Asking</span>
          <strong>{asking}</strong>
          <small>{shownPriceSource(deal) || (deal.asking_price_display ? "Listing" : "")}</small>
          {deal.asking_price_display ? <em>Broker-stated</em> : null}
        </article>
        <article>
          <span>Land</span>
          <strong>{acres}</strong>
          {deal.land_acres_basis ? <em>{basisLabel(deal.land_acres_basis)}</em> : null}
        </article>
        <article>
          <span>Per acre</span>
          <strong>{perAcre}</strong>
          <small>{rank?.label || (deal.land_acres_basis === "Unknown" ? "From the listing acreage" : deal.land_acres != null ? "From the acreage on file" : "")}</small>
        </article>
        <article>
          <span>Open land</span>
          <strong>{open}</strong>
          <small>{deal.open_land_sqft != null ? "aerial" : "No aerial check yet"}</small>
          {deal.open_land_sqft != null ? <em>Estimated</em> : null}
        </article>
        <article>
          <span>Depot</span>
          <strong>{depotLine(deal.miles_to_depot, hasPin)}</strong>
          <small>{hasPin ? "straight line" : ""}</small>
        </article>
        <article className="wide">
          <span>{deal.stated_revenue_display && !deal.stated_cash_flow_display ? "Revenue" : "Cash flow"}</span>
          <strong>{cash.value}</strong>
          <small>{cash.note}{cash.extra ? ` · ${cash.extra}` : ""}</small>
          {cash.basis ? <em>{cash.basis}</em> : null}
        </article>
        <article>
          <span>Site capacity</span>
          <strong>{deal.site_capacity || "Unknown"}</strong>
          <small>{deal.site_capacity && deal.site_capacity !== "Unknown" ? "" : "Not rated"}</small>
        </article>
      </div>
      {rank ? (
        <div className="rank-bar" title={rank.label}>
          <span>Asking per acre</span>
          <i><b style={{ left: `${rank.pct * 100}%` }} /></i>
        </div>
      ) : null}
      <p className={`stage-pill tone-${tone}`}>{stageDetail(deal.stage, deal.stage_group)}{deal.checked_live ? ` · ${checkedPhrase(deal.checked_live)}` : ""}</p>
    </section>
  );
}
