"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { Banknote, LandPlot, Ruler, Trees, Wallet } from "lucide-react";
import type { DealProps, SiteProps } from "@/lib/types";
import { baysLine, basisLabel, cashTile, depotLine, fullMoney, isOpenLandBlank, revenueTile, sheetMoney, showsFinancials, spareLandSqft, tradeAreaLines, workbookTrafficLine, type CapacityFact } from "@/lib/keyNumbers";
import { basisBadge } from "@/lib/pricing";
import { stripGmailIds } from "@/lib/displayText";
import PowerEvidence from "./PowerEvidence";
import { panelFromDeal, type FinancialPanel } from "@/lib/financials";
import { commentList, type OpenPnlComment } from "@/lib/comments/anchor";
import { COMMENT_CHANGED } from "@/lib/comments/nav";
import { conflictList, type DataConflict } from "@/lib/conflicts/view";
import { emptyStatement, type PnlStatement } from "@/lib/pnl/statement";
import PnlOverlay from "./PnlOverlay";
import { listingCue, shownPriceSource } from "@/lib/format";
import FinancialsPanel from "./FinancialsPanel";
import { PendingFigure, type PnlTiles } from "./FinancialsEntry";

export function CapacityFacts({ facts }: { facts: CapacityFact[] }) {
  if (!facts.length) return <strong title="Not on file">—</strong>;
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
      <strong title={title || (value === "—" ? "Not on file" : value)}>{value}</strong>
      {note ? <small>{note}</small> : null}
      {basis ? <em>{basis}</em> : null}
    </article>
  );
}

function readPnl(value: unknown): PnlStatement {
  if (!value || typeof value !== "object") return emptyStatement();
  const row = value as PnlStatement;
  if (row.status === "empty" || row.status === "unavailable") {
    return {
      status: row.status,
      message: typeof row.message === "string" && row.message ? row.message : emptyStatement().message,
      years: [],
      normalizedYears: [],
      hasNormalized: false,
    };
  }
  if (row.status !== "ready" || !Array.isArray(row.years)) return emptyStatement();
  return row;
}


export function SitePacket({
  site,
  deal,
  hasPin,
  signedIn = false,
  tiles = null,
  pending = false,
}: {
  site: SiteProps;
  deal?: DealProps | null;
  hasPin: boolean;
  signedIn?: boolean;
  tiles?: PnlTiles | null;
  pending?: boolean;
}) {
  if (deal) return <KeyStrip deal={deal} hasPin={hasPin} peers={[]} universeSite={site} signedIn={signedIn} tiles={tiles} pending={pending} />;
  const asking = site.asking_price_display || "";
  const spare = spareLandSqft(null, site.spare_ac_own);
  const acres = site.parcel_acres != null ? `${site.parcel_acres} ac` : site.lot_ac != null ? `${site.lot_ac} ac` : "";
  return (
    <section className="key-strip packet" data-testid="key-strip">
      <h3 className="job">Space</h3>
      <div className="metrics">
        {acres ? <Metric icon={LandPlot} label="Land" value={acres} /> : null}
        <Metric icon={Trees} label="Open land" value={spare.value} note={spare.note} title={isOpenLandBlank(spare.value) ? "Not on file" : undefined} />
      </div>
      <PowerEvidence site={site} signedIn={signedIn} />
      <h3 className="job">Attractiveness</h3>
      <div className="metrics">
        {asking ? <Metric icon={Wallet} label="Asking" value={asking} title={asking} /> : <Metric icon={Wallet} label="Asking" value="—" title="Not on file" />}
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
  tiles = null,
  pending = false,
}: {
  deal: DealProps;
  hasPin: boolean;
  peers?: DealProps[];
  universeSite?: SiteProps | null;
  signedIn?: boolean;
  tiles?: PnlTiles | null;
  pending?: boolean;
}) {
  const cash = cashTile(deal);
  const acres = deal.land_acres != null ? `${deal.land_acres} ac` : "—";
  const askingText = sheetMoney(deal.asking_price, deal.asking_price_display);
  const cashView = deal.stated_cash_flow != null || deal.stated_cash_flow_display
    ? { text: sheetMoney(deal.stated_cash_flow, deal.stated_cash_flow_display), title: sheetMoney(deal.stated_cash_flow, deal.stated_cash_flow_display) }
    : { text: cash.value || "—", title: cash.value || "—" };
  const revenue = revenueTile(deal);
  const revenueBasis = deal.stated_revenue != null ? basisBadge(deal.revenue_basis) : "";
  const bays = baysLine(deal);
  const traffic = workbookTrafficLine(deal);
  const trade = tradeAreaLines(deal);
  const params = useSearchParams();
  const deepFinancials = params.get("panel") === "financials";
  const grain = params.get("pl") === "monthly" ? "monthly" : params.get("pl") === "annual" ? "annual" : null;
  const [financialsOpen, setFinancialsOpen] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [financials, setFinancials] = useState<FinancialPanel | null>(null);
  const [conflicts, setConflicts] = useState<DataConflict[]>([]);
  const [comments, setComments] = useState<OpenPnlComment[]>([]);
  const [commentTick, setCommentTick] = useState(0);
  useEffect(() => {
    const refresh = () => setCommentTick((value) => value + 1);
    window.addEventListener(COMMENT_CHANGED, refresh);
    return () => window.removeEventListener(COMMENT_CHANGED, refresh);
  }, []);
  const showFinancials = showsFinancials(deal);
  useEffect(() => {
    setFinancialsOpen(deepFinancials && signedIn === true && showFinancials);
    setFinancials(null);
    setConflicts([]);
    setComments([]);
  }, [deal.deal_id, deepFinancials, signedIn, showFinancials]);
  useEffect(() => {
    if (!signedIn || !showFinancials) return undefined;
    let cancel = false;
    if (commentTick === 0) {
      setFinancials(null);
      setConflicts([]);
      setComments([]);
    }
    fetch(`/api/data/financials/${encodeURIComponent(deal.deal_id)}`, { cache: "no-store" })
      .then(async (response) => (response.ok ? (await response.json()) as FinancialPanel & { conflicts?: unknown; comments?: unknown } : null))
      .then((panel) => {
        if (cancel || !panel) return;
        setFinancials({ ...panel, pnl: readPnl(panel.pnl) });
        setConflicts(conflictList(panel.conflicts));
        setComments(commentList(panel.comments));
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [signedIn, showFinancials, deal.deal_id, commentTick]);
  const fallbackPanel = useMemo(() => panelFromDeal(deal), [deal]);
  const shownPanel = showFinancials ? (financials ?? fallbackPanel) : null;
  const population = trade.find((line) => line.startsWith("3-mile population"));
  const washes = trade.find((line) => line.startsWith("Washes "));
  const growth = trade.find((line) => line.startsWith("Growth "));
  const income = trade.find((line) => line.startsWith("Income "));
  const listing = listingCue(deal);
  const spare = spareLandSqft(deal.open_land_sqft, universeSite?.spare_ac_own, deal.open_land_basis);
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
        <Metric icon={Trees} label="Open land" value={spare.value} note={spare.note} title={isOpenLandBlank(spare.value) ? "Not on file" : undefined} />
        <Metric icon={Ruler} label="Bays that fit" value={bays ? bays.replace("Bays that fit ", "") : "—"} title={bays ? undefined : "Not on file"} />
      </div>
      <PowerEvidence deal={deal} signedIn={signedIn} />
      <h3 className="job">Attractiveness</h3>
      <div className="metrics">
        {signedIn && showFinancials ? (
          <article className="wide">
            {pending ? (
              <div className="fin-tile" data-testid="revenue-tile" aria-busy="true">
                <span><Banknote size={15} strokeWidth={1.75} aria-hidden="true" /> Revenue</span>
                <PendingFigure />
              </div>
            ) : (
              <button type="button" className="fin-tile" data-testid="revenue-tile" onClick={() => setFinancialsOpen(true)}>
                <span><Banknote size={15} strokeWidth={1.75} aria-hidden="true" /> Revenue</span>
                <strong title={(tiles?.revenue || revenue).title}>{(tiles?.revenue || revenue).text}</strong>
                <small className="figure-hold">{tiles ? tiles.revenue.note : (deal.revenue_period || "")}</small>
                {tiles ? null : revenueBasis ? <em>{revenueBasis}</em> : null}
              </button>
            )}
          </article>
        ) : null}
        {signedIn && !cash.hidden && showFinancials ? (
          <article className="wide">
            {pending ? (
              <div className="fin-tile" data-testid="cash-flow-tile" aria-busy="true">
                <span><Banknote size={15} strokeWidth={1.75} aria-hidden="true" /> {tiles?.cash.note.split(" · ")[0] || deal.cash_flow_label || "Cash flow"}</span>
                <PendingFigure />
              </div>
            ) : (
              <button type="button" className="fin-tile" data-testid="cash-flow-tile" onClick={() => setFinancialsOpen(true)}>
                <span><Banknote size={15} strokeWidth={1.75} aria-hidden="true" /> {tiles?.cash.note.split(" · ")[0] || deal.cash_flow_label || "Cash flow"}</span>
                <strong title={tiles?.cash.title || cashView.title}>{tiles?.cash.text || cashView.text}</strong>
                <small className="figure-hold">{tiles ? tiles.cash.note : cashNote}</small>
                {tiles ? null : cashBasis ? <em>{cashBasis}</em> : null}
              </button>
            )}
          </article>
        ) : null}
        <Metric icon={Wallet} label="Asking" value={signedIn ? askingText : "—"} title={signedIn ? askingText : "—"} note={signedIn ? (shownPriceSource(deal) || "") : ""} basis={signedIn && deal.asking_price_display ? "Broker-stated" : ""} />
        {trafficValue ? <Metric icon={Wallet} label="Nearest traffic" value={trafficValue} note={trafficNote} /> : null}
        {deal.trade_aadt_max != null ? <Metric icon={Wallet} label="Max traffic" value={Math.round(deal.trade_aadt_max).toLocaleString()} note="Workbook trade area" /> : null}
        {population ? <Metric icon={Wallet} label="3-mile population" value={population.replace("3-mile population ", "")} /> : null}
        {washes ? <Metric icon={Wallet} label="Washes" value={washes.replace(/^Washes /, "")} /> : null}
      </div>
      {signedIn && showFinancials && financialsOpen && shownPanel ? createPortal(
        <PnlOverlay statement={shownPanel.pnl ?? emptyStatement()} conflicts={conflicts} comments={comments} siteId={signedIn ? deal.deal_id : ""} initialGrain={grain} onClose={() => setFinancialsOpen(false)} onChecklist={() => setChecklistOpen(true)} />,
        document.body,
      ) : null}
      {signedIn && showFinancials && checklistOpen && shownPanel?.open ? (
        <FinancialsPanel dealId={deal.deal_id} initial={shownPanel} onClose={() => setChecklistOpen(false)} />
      ) : null}

      <div className="supporting">
        {growth ? <><span>Growth</span><strong>{growth.replace(/^Growth /, "")}</strong></> : null}
        {income ? <><span>Income</span><strong>{income.replace(/^Income /, "")}</strong></> : null}
        {signedIn && deal.price_per_acre != null ? <><span>Per acre</span><strong>{fullMoney(deal.price_per_acre)}</strong></> : null}
        <span>Depot</span><strong>{depotLine(deal.miles_to_depot, hasPin)}</strong>
        {deal.access_notes ? <><span>Access</span><strong data-testid="access-notes">{stripGmailIds(deal.access_notes)}</strong></> : null}
        {listing.label ? <><span>Listing</span><strong>{listing.label}</strong></> : null}
      </div>
    </section>
  );
}
