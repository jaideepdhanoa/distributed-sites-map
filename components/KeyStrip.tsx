"use client";

import { useEffect, useMemo, useState } from "react";
import { Banknote, Gauge, LandPlot, MapPin, Ruler, Trees, Wallet } from "lucide-react";
import type { DealProps } from "@/lib/types";
import { basisLabel, baysLine, cashTile, depotLine, factsForDeal, fullMoney, openLandText, peerNote, showsFinancials, tileAmount, tradeAreaLines, workbookTrafficLine, type CapacityFact } from "@/lib/keyNumbers";
import { panelFromDeal, safePackageHref, type FinancialPanel } from "@/lib/financials";
import { shownPriceSource } from "@/lib/format";
import FinancialsPanel from "./FinancialsPanel";

function CountUp({ value }: { value: string }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const match = value.match(/-?\d[\d,]*(?:\.\d+)?/);
    if (!match || reduce || /not |package |vacant /i.test(value)) {
      setShown(value);
      return;
    }
    const target = Number(match[0].replaceAll(",", ""));
    if (!Number.isFinite(target)) {
      setShown(value);
      return;
    }
    const decimals = match[0].includes(".") ? match[0].split(".")[1].length : 0;
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / 300);
      const current = target * progress;
      const formatted = decimals ? current.toFixed(decimals) : Math.round(current).toLocaleString();
      setShown(value.replace(match[0], formatted));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{shown}</>;
}

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
      <strong title={title || value}><CountUp value={value} /></strong>
      {note ? <small>{note}</small> : null}
      {basis ? <em>{basis}</em> : null}
    </article>
  );
}

export default function KeyStrip({
  deal,
  hasPin,
  peers,
  signedIn = false,
}: {
  deal: DealProps;
  hasPin: boolean;
  peers: DealProps[];
  signedIn?: boolean;
}) {
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
  const facts = factsForDeal(deal);
  const bays = baysLine(deal);
  const traffic = workbookTrafficLine(deal);
  const trade = tradeAreaLines(deal);
  const [financialsOpen, setFinancialsOpen] = useState(false);
  const [financials, setFinancials] = useState<FinancialPanel | null>(null);
  const showFinancials = showsFinancials(deal);
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
  const packageHref = safePackageHref(financials?.packageHref, signedIn);
  const fallbackPanel = useMemo(() => panelFromDeal(deal), [deal]);
  const shownPanel = financials ?? fallbackPanel;
  return (
    <section className="key-strip" data-testid="key-strip">
      <div className="metrics">
        <Metric icon={Wallet} label="Asking" value={askingTile.text} title={askingTile.title} note={shownPriceSource(deal) || (deal.asking_price_display ? "Listing" : "")} basis={deal.asking_price_display ? "Broker-stated" : ""} />
        <Metric icon={LandPlot} label="Land" value={acres} basis={basisLabel(deal.land_acres_basis)} />
        <Metric icon={Ruler} label="Per acre" value={perAcreTile.text} title={perAcreTile.title} note={rank?.label || (deal.land_acres_basis === "Unknown" ? "From the listing acreage" : deal.land_acres != null ? "From the acreage on file" : "")} />
        <Metric icon={Trees} label="Open land" value={openTile.text} title={openTile.title} note={[deal.open_land_sqft != null ? "sq ft · aerial" : "No aerial check yet", bays].filter(Boolean).join(" · ")} basis={deal.open_land_sqft != null ? "Estimated" : ""} />
        <article className={facts.length > 1 ? "wide" : ""}>
          <span><Gauge size={15} strokeWidth={1.75} aria-hidden="true" /> Site capacity</span>
          <CapacityFacts facts={facts} />
        </article>
        <Metric icon={MapPin} label="Depot" value={depotLine(deal.miles_to_depot, hasPin)} note={hasPin ? "straight line" : ""} />
        {cash.hidden ? null : signedIn && showFinancials ? (
          <article className="wide">
            <button type="button" className="fin-tile" data-testid="cash-flow-tile" onClick={() => setFinancialsOpen(true)}>
              <span><Banknote size={15} strokeWidth={1.75} aria-hidden="true" /> {deal.stated_revenue_display && !deal.stated_cash_flow_display ? "Revenue" : "Cash flow"}</span>
              <strong title={cashView.title}><CountUp value={cashView.text} /></strong>
              {cash.note || cash.extra ? <small>{`${cash.note}${cash.extra ? ` · ${cash.extra}` : ""}`}</small> : null}
              {cash.basis ? <em>{cash.basis}</em> : null}
            </button>
            {packageHref ? <a href={packageHref} target="_blank" rel="noopener noreferrer">Open package</a> : null}
          </article>
        ) : (
          <Metric icon={Banknote} label={deal.stated_revenue_display && !deal.stated_cash_flow_display ? "Revenue" : "Cash flow"} value={cashView.text} title={cashView.title} note={`${cash.note}${cash.extra ? ` · ${cash.extra}` : ""}`} basis={cash.basis} />
        )}
      </div>
      {signedIn && financialsOpen && shownPanel.open ? (
        <FinancialsPanel dealId={deal.deal_id} initial={shownPanel} onClose={() => setFinancialsOpen(false)} />
      ) : null}
      {traffic || trade.length ? (
        <div className="trade-area" data-testid="trade-area">
          {traffic ? <p>{traffic}</p> : null}
          {trade.map((line) => <p key={line}>{line}</p>)}
        </div>
      ) : null}
      {rank ? (
        <div className="rank-bar" title={rank.label}>
          <span>Asking per acre</span>
          <i><b style={{ left: `${rank.pct * 100}%` }} /></i>
        </div>
      ) : null}
    </section>
  );
}
