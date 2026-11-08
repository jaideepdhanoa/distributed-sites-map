"use client";

import { Banknote, LandPlot, Ruler, Trees, Wallet } from "lucide-react";
import type { DealProps } from "@/lib/types";
import { acreUnit, baysLine, basisLabel, cashTile, depotLine, factsForDeal, fullMoney, openLandText, sheetMoney, tradeAreaLines, workbookTrafficLine, type CapacityFact } from "@/lib/keyNumbers";
import { listingCue, shownPriceSource } from "@/lib/format";
import type { SiteProps } from "@/lib/types";

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
  universeSite,
}: {
  deal: DealProps;
  hasPin: boolean;
  peers: DealProps[];
  universeSite?: SiteProps | null;
}) {
  const cash = cashTile(deal);
  const acres = deal.land_acres != null ? `${deal.land_acres} ac` : "Not provided";
  const askingText = sheetMoney(deal.asking_price, deal.asking_price_display);
  const cashView = deal.stated_cash_flow != null || deal.stated_cash_flow_display
    ? { text: sheetMoney(deal.stated_cash_flow, deal.stated_cash_flow_display), title: sheetMoney(deal.stated_cash_flow, deal.stated_cash_flow_display) }
    : deal.stated_revenue != null && !deal.stated_cash_flow_display
      ? { text: sheetMoney(deal.stated_revenue, deal.stated_revenue_display), title: sheetMoney(deal.stated_revenue, deal.stated_revenue_display) }
      : { text: cash.value, title: cash.value };
  const facts = factsForDeal(deal);
  const capacityLabels = ["Peak load", "Year load", "Frontage hosting", "Nearby hosting", "Substation", "Line", "Feeder", "Horizon", "Phase"];
  const capacity = facts.flatMap((fact) => fact.lines.map((line) => {
    const label = capacityLabels.find((item) => line.startsWith(`${item} `));
    if (!label) return { label: "Service", value: line };
    return { label, value: line.slice(label.length + 1) };
  }));
  const bays = baysLine(deal);
  const traffic = workbookTrafficLine(deal);
  const trade = tradeAreaLines(deal);
  const population = trade.find((line) => line.startsWith("3-mile population"));
  const washes = trade.find((line) => line.startsWith("Washes "));
  const growth = trade.find((line) => line.startsWith("Growth "));
  const income = trade.find((line) => line.startsWith("Income "));
  const listing = listingCue(deal);
  const ownSpare = universeSite?.spare_ac_own != null ? acreUnit(universeSite.spare_ac_own, universeSite.spare_ac_own_text) : "";
  const trafficValue = deal.trade_aadt != null ? `${Math.round(deal.trade_aadt).toLocaleString()} vehicles/day` : "";
  const trafficNote = traffic
    .replace(/^[\d,]+ vehicles\/day · /, "")
    .replace(/ · max [\d,]+/, "")
    .replace(/ · Workbook trade area$/, "");
  return (
    <section className="key-strip packet" data-testid="key-strip">
      <h3 className="job">Space</h3>
      <div className="metrics">
        <Metric icon={LandPlot} label="Land" value={acres} basis={basisLabel(deal.land_acres_basis)} />
        <Metric icon={Trees} label="Workbook spare" value={deal.open_land_sqft != null ? openLandText(deal.open_land_sqft) : "Not measured"} note="Sheet spare area, square feet" />
        {ownSpare ? <Metric icon={Trees} label="Universe own spare" value={ownSpare} note="Census own-parcel spare, acres" /> : null}
        <Metric icon={Ruler} label="Bays that fit" value={bays ? bays.replace("Bays that fit ", "") : "Not provided"} />
      </div>
      <h3 className="job">Capacity</h3>
      {capacity.length ? (
        <div className="metrics">
          {capacity.map((item) => <Metric key={`${item.label}-${item.value}`} icon={Ruler} label={item.label} value={item.value} />)}
        </div>
      ) : <p className="note">Not on file</p>}
      <h3 className="job">Attractiveness</h3>
      <div className="metrics">
        <Metric icon={Wallet} label="Asking" value={askingText} title={askingText} note={shownPriceSource(deal) || ""} basis={deal.asking_price_display ? "Broker-stated" : ""} />
        <Metric icon={Banknote} label="Cash flow" value={cashView.text} title={cashView.title} note={cash.note} basis={cash.basis} />
        {trafficValue ? <Metric icon={Wallet} label="Nearest traffic" value={trafficValue} note={trafficNote} /> : null}
        {deal.trade_aadt_max != null ? <Metric icon={Wallet} label="Max traffic" value={Math.round(deal.trade_aadt_max).toLocaleString()} note="Workbook trade area" /> : null}
        {population ? <Metric icon={Wallet} label="3-mile population" value={population.replace("3-mile population ", "")} /> : null}
        {washes ? <Metric icon={Wallet} label="Washes" value={washes.replace(/^Washes /, "")} /> : null}
      </div>
      <div className="supporting">
        {growth ? <><span>Growth</span><strong>{growth.replace(/^Growth /, "")}</strong></> : null}
        {income ? <><span>Income</span><strong>{income.replace(/^Income /, "")}</strong></> : null}
        {deal.price_per_acre != null ? <><span>Per acre</span><strong>{fullMoney(deal.price_per_acre)}</strong></> : null}
        <span>Depot</span><strong>{depotLine(deal.miles_to_depot, hasPin)}</strong>
        {deal.access_notes ? <><span>Access</span><strong data-testid="access-notes">{deal.access_notes}</strong></> : null}
        {listing.label ? <><span>Listing</span><strong>{listing.label}</strong></> : null}
      </div>
    </section>
  );
}
