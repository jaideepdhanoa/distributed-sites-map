"use client";

import { Banknote, Gauge, LandPlot, MapPin, Ruler, Trees, Wallet } from "lucide-react";
import type { DealProps } from "@/lib/types";
import { basisLabel, baysLine, cashTile, depotLine, displayScore, factsForDeal, fullMoney, openLandText, peerNote, sheetMoney, tradeAreaLines, workbookTrafficLine, type CapacityFact } from "@/lib/keyNumbers";
import { shownPriceSource } from "@/lib/format";

export function CapacityFacts({ facts }: { facts: CapacityFact[] }) {
  if (!facts.length) return <strong>Not on file</strong>;
  return (
    <div className="fact-stack" data-testid="capacity-facts">
      {facts.map((fact) => (
        <p key={fact.id}>
          {fact.lines.map((line) => <strong key={line}>{line}</strong>)}
          {fact.basis ? <small>{fact.basis}</small> : null}
        </p>
      ))}
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  title,
  note,
  basis,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  title?: string;
  note?: string;
  basis?: string;
}) {
  return (
    <article className={label === "Cash flow" || label === "Revenue" ? "wide" : ""}>
      <span><Icon size={15} strokeWidth={1.75} aria-hidden="true" /> {label}</span>
      <strong title={title || value}>{value}</strong>
      {note ? <small>{note}</small> : null}
      {basis ? <em>{basis}</em> : null}
    </article>
  );
}

export default function KeyStrip({
  deal,
  hasPin,
  peers,
}: {
  deal: DealProps;
  hasPin: boolean;
  peers: DealProps[];
}) {
  const rank = peerNote(deal, peers);
  const cash = cashTile(deal);
  const acres = deal.land_acres != null ? `${deal.land_acres} ac` : "Not provided";
  const openTile = deal.open_land_sqft != null
    ? { text: Math.round(deal.open_land_sqft).toLocaleString(), title: openLandText(deal.open_land_sqft) }
    : { text: "Not measured", title: "Not measured" };
  const perAcreTile = deal.price_per_acre != null
    ? { text: deal.price_per_acre_display || fullMoney(deal.price_per_acre), title: fullMoney(deal.price_per_acre) }
    : { text: "Not provided", title: "Not provided" };
  const askingText = sheetMoney(deal.asking_price, deal.asking_price_display);
  const cashView = deal.stated_cash_flow != null || deal.stated_cash_flow_display
    ? { text: sheetMoney(deal.stated_cash_flow, deal.stated_cash_flow_display), title: sheetMoney(deal.stated_cash_flow, deal.stated_cash_flow_display) }
    : deal.stated_revenue != null && !deal.stated_cash_flow_display
      ? { text: sheetMoney(deal.stated_revenue, deal.stated_revenue_display), title: sheetMoney(deal.stated_revenue, deal.stated_revenue_display) }
      : { text: cash.value, title: cash.value };
  const score = displayScore(deal.score);
  const facts = factsForDeal(deal);
  const bays = baysLine(deal);
  const traffic = workbookTrafficLine(deal);
  const trade = tradeAreaLines(deal);
  return (
    <section className="key-strip" data-testid="key-strip">
      <div className="metrics">
        <Metric icon={Wallet} label="Asking" value={askingText} title={askingText} note={shownPriceSource(deal) || (deal.asking_price_display ? "Listing" : "")} basis={deal.asking_price_display ? "Broker-stated" : ""} />
        <Metric icon={LandPlot} label="Land" value={acres} basis={basisLabel(deal.land_acres_basis)} />
        <Metric icon={Ruler} label="Per acre" value={perAcreTile.text} title={perAcreTile.title} note={rank?.label || (deal.land_acres_basis === "Unknown" ? "From the listing acreage" : deal.land_acres != null ? "From the acreage on file" : "")} />
        <Metric icon={Trees} label="Open land" value={openTile.text} title={openTile.title} note={[deal.open_land_sqft != null ? "sq ft · aerial" : "No aerial check yet", bays].filter(Boolean).join(" · ")} basis={deal.open_land_sqft != null ? "Estimated" : ""} />
        <article className={facts.length > 1 ? "wide" : ""}>
          <span><Gauge size={15} strokeWidth={1.75} aria-hidden="true" /> Site capacity</span>
          <CapacityFacts facts={facts} />
        </article>
        <Metric icon={MapPin} label="Depot" value={depotLine(deal.miles_to_depot, hasPin)} note={hasPin ? "straight line" : ""} />
        <Metric icon={Banknote} label={deal.stated_revenue_display && !deal.stated_cash_flow_display ? "Revenue" : "Cash flow"} value={cashView.text} title={cashView.title} note={`${cash.note}${cash.extra ? ` · ${cash.extra}` : ""}`} basis={cash.basis} />
      </div>
      {traffic || trade.length || score ? (
        <div className="trade-area" data-testid="trade-area">
          {traffic ? <p>{traffic}</p> : null}
          {trade.map((line) => <p key={line}>{line}</p>)}
          {score ? <p>Score {score} of 100</p> : null}
        </div>
      ) : null}
      {deal.access_notes ? <p className="access-note" data-testid="access-notes">Access and visibility: {deal.access_notes}</p> : null}
      {rank ? (
        <div className="rank-bar" title={rank.label}>
          <span>Asking per acre</span>
          <i><b style={{ left: `${rank.pct * 100}%` }} /></i>
        </div>
      ) : null}
    </section>
  );
}
