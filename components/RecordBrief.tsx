import type { PowerRecords } from "@/lib/powerLinkIndex";
import { PowerFollowUp } from "./PowerEvidence";
import { useRouter } from "next/navigation";
import { currentSearch, rememberSearch } from "@/lib/navSearch";
import { pipelineCost } from "@/lib/charging/pipelineCost";
import { ChargingLink } from "./ChargingLink";
import OpportunityReview from "./OpportunityReview";
import SiteCoverageReview from "./SiteCoverageReview";
import FinancialsEntry from "./FinancialsEntry";
import { screeningEvidence } from "@/lib/screeningEvidence";
import { financialsCard } from "@/lib/pnl/cue";
import { stageTone } from "@/lib/labels";
import { cashTile } from "@/lib/keyNumbers";
import type { PnlStatement } from "@/lib/pnl/statement";
import RecordFinding from "./actions/RecordFinding";

type Figure = ReturnType<typeof screeningEvidence>["figures"][number];
type BriefProps = Parameters<typeof screeningEvidence>[0] & {
  power?: PowerRecords;
  target?: { kind: "site" | "deal"; id: string };
  pnl?: { statement: PnlStatement | null; settled: boolean; sample: boolean };
};

function FigureRow({ fact }: { fact: Figure }) {
  const source = fact.source || "Source not recorded";
  const date = fact.date && source.includes(fact.date) ? "" : fact.date || "Date not recorded";
  return <div><dt>{fact.label}</dt><dd>{fact.value}<small>{[source, date].filter(Boolean).join(" · ")}</small></dd></div>;
}

export default function RecordBrief({ target, pnl, power, ...input }: BriefProps) {
  const router = useRouter();
  const { status, reason, origin, review, evidence, check, missing, figures } = screeningEvidence(input);
  const opportunity = input.signedIn && input.deal?.opportunityReview;
  const cost = pipelineCost(input.deal?.charging);
  const financial = check === "financials" && input.signedIn;
  const coverage = financial && pnl?.statement ? financialsCard(pnl.statement, pnl.sample)?.coverage : "";
  const land = check === "space";
  const asking = figures.find(fact => fact.label === "Asking price");
  const first = financial || (land && missing) ? undefined
    : input.deal && input.deal.kind !== "land" && !land && check !== "county" ? asking || figures[0] : figures[0];
  const fit = figures.find(fact => fact.label === "Assessed layout") || figures.find(fact => fact.label === "Earlier workbook bays" || fact.label === "Open land");
  const economics = figures.find(fact => fact.label === (input.deal?.cash_flow_label || "Cash flow")) || figures.find(fact => fact.label === "Asking price");
  const featuredEconomics = economics !== first ? economics : undefined;
  const showFinancialAsk = financial && asking && asking !== featuredEconomics;
  const others = figures.filter(fact => fact !== first && fact !== featuredEconomics && !(showFinancialAsk && fact === asking));
  const cash = input.signedIn && input.deal ? cashTile(input.deal) : null;
  const cashGap = !economics && cash && !cash.hidden ? (cash.value === "—" ? "Cash flow not on file" : cash.value) : "";
  const source = evidence?.kind === "county" ? evidence.href : financial && coverage ? `Financial statement · ${coverage}` : land && first?.label === "Open land" ? first.source : "";
  const metrics = input.signedIn && input.deal?.kind === "pipeline" && <>
          <div><dt>Charging spaces</dt><dd>{input.deal.chargingSpace?.value ?? "No layout estimate"}<small>{input.deal.chargingSpace?.basis}</small></dd></div>
          <div><dt>Cost per charge</dt><dd>{input.deal.charging
            ? <ChargingLink site={input.deal.deal_id} revision={input.deal.charging.selected}>{cost.value}</ChargingLink> : cost.value}<small>{cost.basis}</small></dd></div>
        </>;
  const supporting = <>
      {!opportunity && reason && reason !== status && <p>{reason}</p>}
      <dl>
        <div><dt>{opportunity ? "Recorded site check" : origin}</dt><dd>{evidence?.kind === "county"
          ? <a href={evidence.href} target="_blank" rel="noopener noreferrer">{review} <span aria-hidden="true">↗</span><span className="sr"> (opens in a new tab)</span></a>
          : evidence?.kind === "space" || evidence?.kind === "layout" ? <button type="button" className="text-link" onClick={() => {
            const query = new URLSearchParams(currentSearch());
            query.set("panel", evidence.kind === "layout" ? "space-options" : "open-land");
            const href = `/?${query}`;
            rememberSearch(href); router.replace(href, { scroll: false });
          }}>{review}</button> : review}{input.signedIn && /power|utility|electrical/i.test(review) && !evidence && <PowerFollowUp {...(power || {deal:input.deal,site:input.site})} />}{missing && !land && <small>{missing}</small>}</dd></div>
        {!opportunity && metrics}
        <div><dt>Site fit</dt><dd>{fit?.label === "Assessed layout" ? fit.value : input.site?.verdict || (fit ? fit.label + " · " + fit.value : "Fit requires verification")}</dd></div>
        {financial ? <div><dt>Statement coverage</dt><dd>{coverage || (pnl?.settled ? "No statement coverage on file." : "Checking statement coverage…")}{coverage && evidence?.kind === "financials" && <FinancialsEntry dealId={evidence.id} loaded={pnl} compact="link" />}</dd></div>
          : land && missing ? <div><dt>Open land</dt><dd>{missing}</dd></div>
          : first ? <FigureRow fact={first} /> : <div><dt>Evidence</dt><dd>No screening figures on file.</dd></div>}
        {input.signedIn && !economics && !cashGap && <div><dt>Economics</dt><dd>{cash?.hidden || input.deal?.kind === "land" ? "Operating income not applicable" : "No asking price or operating income on file"}</dd></div>}
        {showFinancialAsk && <FigureRow fact={asking} />}
        {featuredEconomics && <FigureRow fact={featuredEconomics} />}
        {cashGap && <div><dt>Cash flow</dt><dd>{cashGap}</dd></div>}
      </dl>
      {target && input.signedIn && <RecordFinding key={target.kind + target.id} kind={target.kind} id={target.id} source={source} review={review} />}
      {others.length > 0 && <details className="disclosure brief-figures">
        <summary className="disclosure">More figures ({others.length})</summary>
        <dl>{others.map(fact => <FigureRow key={fact.label} fact={fact} />)}</dl>
      </details>}
  </>;
  return (
    <section className="record-brief" aria-label="Screening decision">
      {opportunity && input.deal ? <>
        {input.deal.pendingDrop && <p><b>Drop proposal awaiting approval.</b> Review the proposal before taking the next step.</p>}
        <OpportunityReview record review={opportunity} charging={input.deal.charging}
          active={Boolean(input.deal.stage) && !/dropped|off[ -]?market/i.test(input.deal.stage || "") && input.deal.stage_group !== "dropped"}/>
        <p><b>Deal stage</b> <span className={`stage-pill tone-${stageTone(input.deal)}`}>{status === "Desk screen" ? "Initial review" : status}</span></p>
        {metrics && <dl>{metrics}</dl>}
        {opportunity.coverage && <SiteCoverageReview evidence={opportunity.coverage}/>}
        <details className="disclosure"><summary className="disclosure">Screening facts and follow-up</summary>{supporting}</details>
      </> : <>
        <div className="brief-decision"><span>{input.deal ? "Deal stage" : "Screening status"}</span><h3 className={input.deal ? `stage-pill tone-${stageTone(input.deal)}` : undefined}>{status}</h3></div>
        {supporting}
      </>}
    </section>
  );
}
