import type { DealProps } from "@/lib/types";
import { basisLabel, cashTile, checkedPhrase, depotLine, fullMoney, openLandText, peerNote, tileAmount } from "@/lib/keyNumbers";
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
  const openTile = deal.open_land_sqft != null
    ? { text: Math.round(deal.open_land_sqft).toLocaleString(), title: openLandText(deal.open_land_sqft) }
    : { text: "Not measured", title: "Not measured" };
  const perAcreTile = deal.price_per_acre != null
    ? tileAmount(deal.price_per_acre, fullMoney(deal.price_per_acre))
    : { text: "Not provided", title: "Not provided" };
  const askingTile = tileAmount(deal.asking_price, deal.asking_price_display);
  const cashView = deal.stated_cash_flow != null
    ? tileAmount(deal.stated_cash_flow, deal.stated_cash_flow_display)
    : deal.stated_revenue != null && !deal.stated_cash_flow_display
      ? tileAmount(deal.stated_revenue, deal.stated_revenue_display)
      : { text: cash.value, title: cash.value };
  return (
    <section className="key-strip" data-testid="key-strip">
      <div className="metrics">
        <article>
          <span>Asking</span>
          <strong title={askingTile.title}>{askingTile.text}</strong>
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
          <strong title={perAcreTile.title}>{perAcreTile.text}</strong>
          <small>{rank?.label || (deal.land_acres_basis === "Unknown" ? "From the listing acreage" : deal.land_acres != null ? "From the acreage on file" : "")}</small>
        </article>
        <article>
          <span>Open land</span>
          <strong title={openTile.title}>{openTile.text}</strong>
          <small>{deal.open_land_sqft != null ? "sq ft · aerial" : "No aerial check yet"}</small>
          {deal.open_land_sqft != null ? <em>Estimated</em> : null}
        </article>
        <article>
          <span>Depot</span>
          <strong>{depotLine(deal.miles_to_depot, hasPin)}</strong>
          <small>{hasPin ? "straight line" : ""}</small>
        </article>
        <article className="wide">
          <span>{deal.stated_revenue_display && !deal.stated_cash_flow_display ? "Revenue" : "Cash flow"}</span>
          <strong title={cashView.title}>{cashView.text}</strong>
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
