import { useRouter } from "next/navigation";
import { currentSearch, rememberSearch } from "@/lib/navSearch";
import FinancialsEntry from "./FinancialsEntry";
import { screeningEvidence } from "@/lib/screeningEvidence";
import { financialsCard } from "@/lib/pnl/cue";
import { cashTile } from "@/lib/keyNumbers";
import type { PnlStatement } from "@/lib/pnl/statement";
import RecordFinding from "./actions/RecordFinding";

type Figure = ReturnType<typeof screeningEvidence>["figures"][number];
type BriefProps = Parameters<typeof screeningEvidence>[0] & {
  target?: { kind: "site" | "deal"; id: string };
  pnl?: { statement: PnlStatement | null; settled: boolean; sample: boolean };
};

function FigureRow({ fact }: { fact: Figure }) {
  const source = fact.source || "Source not recorded";
  const date = fact.date && source.includes(fact.date) ? "" : fact.date || "Date not recorded";
  return <div><dt>{fact.label}</dt><dd>{fact.value}<small>{[source, date].filter(Boolean).join(" · ")}</small></dd></div>;
}

export default function RecordBrief({ target, pnl, ...input }: BriefProps) {
  const router = useRouter();
  const { status, reason, review, evidence, check, missing, figures } = screeningEvidence(input);
  const financial = check === "financials" && input.signedIn;
  const coverage = financial && pnl?.statement ? financialsCard(pnl.statement, pnl.sample)?.coverage : "";
  const land = check === "space";
  const first = financial || (land && missing) ? undefined : figures[0];
  const economics = figures.find(fact => fact.label === (input.deal?.cash_flow_label || "Cash flow")) || figures.find(fact => fact.label === "Asking price");
  const featuredEconomics = economics !== first ? economics : undefined;
  const others = figures.filter(fact => fact !== first && fact !== featuredEconomics);
  const cash = input.signedIn && input.deal ? cashTile(input.deal) : null;
  const cashGap = !economics && cash && !cash.hidden ? (cash.value === "—" ? "Cash flow not on file" : cash.value) : "";
  const source = evidence?.kind === "county" ? evidence.href : financial && coverage ? `Financial statement · ${coverage}` : land && first?.label === "Open land" ? first.source : "";
  return (
    <section className="record-brief" aria-label="Screening decision">
      <div className="brief-decision"><span>Screening decision</span><h3>{status}</h3></div>
      {reason && reason !== status && <p>{reason}</p>}
      <dl>
        <div><dt>Next check</dt><dd>{evidence?.kind === "county"
          ? <a href={evidence.href} target="_blank" rel="noopener noreferrer">{review} <span aria-hidden="true">↗</span><span className="sr"> (opens in a new tab)</span></a>
          : evidence?.kind === "space" ? <button type="button" className="text-link" onClick={() => {
            const query = new URLSearchParams(currentSearch());
            query.set("panel", "open-land");
            const href = `/?${query}`;
            rememberSearch(href); router.replace(href, { scroll: false });
          }}>{review}</button> : review}{missing && !land && <small>{missing}</small>}</dd></div>
        {financial ? <div><dt>Statement coverage</dt><dd>{coverage || (pnl?.settled ? "No statement coverage on file." : "Checking statement coverage…")}{coverage && evidence?.kind === "financials" && <FinancialsEntry dealId={evidence.id} loaded={pnl} compact="link" />}</dd></div>
          : land && missing ? <div><dt>Open land</dt><dd>{missing}</dd></div>
          : first ? <FigureRow fact={first} /> : <div><dt>Evidence</dt><dd>No screening figures on file.</dd></div>}
        {featuredEconomics && <FigureRow fact={featuredEconomics} />}
        {cashGap && <div><dt>Cash flow</dt><dd>{cashGap}</dd></div>}
      </dl>
      {target && input.signedIn && <RecordFinding key={target.kind + target.id} kind={target.kind} id={target.id} source={source} review={review} />}
      {others.length > 0 && <details className="disclosure brief-figures">
        <summary className="disclosure">More figures ({others.length})</summary>
        <dl>{others.map(fact => <FigureRow key={fact.label} fact={fact} />)}</dl>
      </details>}
    </section>
  );
}
