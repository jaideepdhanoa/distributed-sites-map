"use client";

import { useEffect, useMemo, useState } from "react";
import { Banknote, LandPlot, Ruler, Trees, Wallet } from "lucide-react";
import type { DealProps, SiteProps } from "@/lib/types";
import { baysLine, basisLabel, cashTile, depotLine, factsForDeal, factsForSite, fullMoney, sheetMoney, showsFinancials, spareLandSqft, tradeAreaLines, workbookTrafficLine, type CapacityFact } from "@/lib/keyNumbers";
import { basisBadge } from "@/lib/pricing";
import PricingSection from "./PricingSection";
import { panelFromDeal, type FinancialPanel } from "@/lib/financials";
import { listingCue, shownPriceSource } from "@/lib/format";
import FinancialsPanel from "./FinancialsPanel";

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

function capacityTiles(facts: { lines: string[] }[]) {
  const capacityLabels = ["Peak load", "Year load", "Frontage hosting", "Nearby hosting", "Substation", "Line", "Feeder", "Horizon", "Phase"];
  return facts.flatMap((fact) => fact.lines.map((line) => {
    const label = capacityLabels.find((item) => line.startsWith(`${item} `));
    if (!label) return { label: "Service", value: line };
    return { label, value: line.slice(label.length + 1) };
  }));
}

export function SitePacket({
  site,
  deal,
  hasPin,
  signedIn = false,
}: {
  site: SiteProps;
  deal?: DealProps | null;
  hasPin: boolean;
  signedIn?: boolean;
}) {
  if (deal) return <KeyStrip deal={deal} hasPin={hasPin} peers={[]} universeSite={site} signedIn={signedIn} />;
  const facts = factsForSite(site);
  const capacity = capacityTiles(facts);
  const asking = site.asking_price_display || "";
  const spare = spareLandSqft(null, site.spare_ac_own);
  const acres = site.parcel_acres != null ? `${site.parcel_acres} ac` : site.lot_ac != null ? `${site.lot_ac} ac` : "";
  return (
    <section className="key-strip packet" data-testid="key-strip">
      <h3 className="job">Space</h3>
      <div className="metrics">
        {acres ? <Metric icon={LandPlot} label="Land" value={acres} /> : null}
        <Metric icon={Trees} label="Spare land" value={spare.value} note={spare.note} />
      </div>
      <h3 className="job">Capacity</h3>
      {capacity.length ? (
        <div className="metrics">
          {capacity.map((item) => <Metric key={`${item.label}-${item.value}`} icon={Ruler} label={item.label} value={item.value} />)}
        </div>
      ) : <p className="note">Not on file</p>}
      <h3 className="job">Attractiveness</h3>
      <div className="metrics">
        {asking ? <Metric icon={Wallet} label="Asking" value={asking} title={asking} /> : <Metric icon={Wallet} label="Asking" value="Not on file" />}
        <Metric icon={Ruler} label="Depot" value={depotLine(site.miles_to_depot, hasPin)} />
      </div>
    </section>
  );
}

export default function KeyStrip({
  deal,
  hasPin,
  universeSite,
  signedIn = false,
}: {
  deal: DealProps;
  hasPin: boolean;
  peers?: DealProps[];
  universeSite?: SiteProps | null;
  signedIn?: boolean;
}) {
  const cash = cashTile(deal);
  const acres = deal.land_acres != null ? `${deal.land_acres} ac` : "Not provided";
  const askingText = sheetMoney(deal.asking_price, deal.asking_price_display);
  const cashView = deal.stated_cash_flow != null || deal.stated_cash_flow_display
    ? { text: sheetMoney(deal.stated_cash_flow, deal.stated_cash_flow_display), title: sheetMoney(deal.stated_cash_flow, deal.stated_cash_flow_display) }
    : { text: cash.value || "—", title: cash.value || "—" };
  const revenueText = deal.stated_revenue_display || (deal.stated_revenue != null ? sheetMoney(deal.stated_revenue, null) : "—");
  const revenueBasis = deal.stated_revenue != null ? basisBadge(deal.revenue_basis) : "";
  const capacity = capacityTiles(factsForDeal(deal));
  const bays = baysLine(deal);
  const traffic = workbookTrafficLine(deal);
  const trade = tradeAreaLines(deal);
  const [financialsOpen, setFinancialsOpen] = useState(false);
  const [financials, setFinancials] = useState<FinancialPanel | null>(null);
  const showFinancials = showsFinancials(deal);
  useEffect(() => {
    setFinancialsOpen(false);
    setFinancials(null);
  }, [deal.deal_id]);
  useEffect(() => {
    if (!signedIn || !showFinancials) return undefined;
    let cancel = false;
    fetch(`/api/data/financials/${encodeURIComponent(deal.deal_id)}`)
      .then(async (response) => (response.ok ? (await response.json()) as FinancialPanel : null))
      .then((panel) => {
        if (!cancel) setFinancials(panel);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [signedIn, showFinancials, deal.deal_id]);
  const fallbackPanel = useMemo(() => panelFromDeal(deal), [deal]);
  const shownPanel = showFinancials ? (financials ?? fallbackPanel) : null;
  const population = trade.find((line) => line.startsWith("3-mile population"));
  const washes = trade.find((line) => line.startsWith("Washes "));
  const growth = trade.find((line) => line.startsWith("Growth "));
  const income = trade.find((line) => line.startsWith("Income "));
  const listing = listingCue(deal);
  const spare = spareLandSqft(deal.open_land_sqft, universeSite?.spare_ac_own);
  const trafficValue = deal.trade_aadt != null ? `${Math.round(deal.trade_aadt).toLocaleString()} vehicles/day` : "";
  const trafficNote = traffic
    .replace(/^[\d,]+ vehicles\/day · /, "")
    .replace(/ · max [\d,]+/, "")
    .replace(/ · Workbook trade area$/, "");
  const cashNote = `${cash.note}${cash.extra ? ` · ${cash.extra}` : ""}`;
  const cashBasis = basisBadge(deal.earnings_basis) || cash.basis;
  return (
    <section className="key-strip packet" data-testid="key-strip">
      <h3 className="job">Space</h3>
      <div className="metrics">
        <Metric icon={LandPlot} label="Land" value={acres} basis={basisLabel(deal.land_acres_basis)} />
        <Metric icon={Trees} label="Spare land" value={spare.value} note={spare.note} />
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
        {signedIn && showFinancials ? (
          <article className="wide">
            <span><Banknote size={15} strokeWidth={1.75} aria-hidden="true" /> Revenue</span>
            <strong title={revenueText}>{revenueText}</strong>
            {deal.revenue_period ? <small>{deal.revenue_period}</small> : null}
            {revenueBasis ? <em>{revenueBasis}</em> : deal.stated_revenue == null ? <small>Not on file</small> : null}
          </article>
        ) : null}
        {signedIn && !cash.hidden && showFinancials ? (
          <article className="wide">
            <button type="button" className="fin-tile" data-testid="cash-flow-tile" onClick={() => setFinancialsOpen(true)}>
              <span><Banknote size={15} strokeWidth={1.75} aria-hidden="true" /> Cash flow</span>
              <strong title={cashView.title}>{cashView.text}</strong>
              {cashNote ? <small>{cashNote}</small> : null}
              {cashBasis ? <em>{cashBasis}</em> : null}
            </button>
          </article>
        ) : null}
        <Metric icon={Wallet} label="Asking" value={signedIn ? askingText : "—"} title={signedIn ? askingText : "—"} note={signedIn ? (shownPriceSource(deal) || "") : ""} basis={signedIn && deal.asking_price_display ? "Broker-stated" : ""} />
        {trafficValue ? <Metric icon={Wallet} label="Nearest traffic" value={trafficValue} note={trafficNote} /> : null}
        {deal.trade_aadt_max != null ? <Metric icon={Wallet} label="Max traffic" value={Math.round(deal.trade_aadt_max).toLocaleString()} note="Workbook trade area" /> : null}
        {population ? <Metric icon={Wallet} label="3-mile population" value={population.replace("3-mile population ", "")} /> : null}
        {washes ? <Metric icon={Wallet} label="Washes" value={washes.replace(/^Washes /, "")} /> : null}
      </div>
      {signedIn && showFinancials && financialsOpen && shownPanel?.open ? (
        <FinancialsPanel dealId={deal.deal_id} initial={shownPanel} onClose={() => setFinancialsOpen(false)} />
      ) : null}
      {signedIn && deal.kind !== "land" ? <PricingSection deal={deal} /> : null}
      <div className="supporting">
        {growth ? <><span>Growth</span><strong>{growth.replace(/^Growth /, "")}</strong></> : null}
        {income ? <><span>Income</span><strong>{income.replace(/^Income /, "")}</strong></> : null}
        {signedIn && deal.price_per_acre != null ? <><span>Per acre</span><strong>{fullMoney(deal.price_per_acre)}</strong></> : null}
        <span>Depot</span><strong>{depotLine(deal.miles_to_depot, hasPin)}</strong>
        {deal.access_notes ? <><span>Access</span><strong data-testid="access-notes">{deal.access_notes}</strong></> : null}
        {listing.label ? <><span>Listing</span><strong>{listing.label}</strong></> : null}
      </div>
    </section>
  );
}
