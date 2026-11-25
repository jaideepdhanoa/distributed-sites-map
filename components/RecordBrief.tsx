import { screeningEvidence } from "@/lib/screeningEvidence";

type Figure = ReturnType<typeof screeningEvidence>["figures"][number];

function FigureRow({ fact }: { fact: Figure }) {
  const source = fact.source || "Source not recorded";
  const date = fact.date && source.includes(fact.date) ? "" : fact.date || "Date not recorded";
  return <div><dt>{fact.label}</dt><dd>{fact.value}<small>{[source, date].filter(Boolean).join(" · ")}</small></dd></div>;
}

export default function RecordBrief(input: Parameters<typeof screeningEvidence>[0]) {
  const { status, reason, review, evidence, missing, figures } = screeningEvidence(input);
  const [first, ...others] = figures;
  return (
    <section className="record-brief" aria-label="Screening decision">
      <div className="brief-decision"><span>Screening decision</span><strong>{status}</strong></div>
      <p>{reason || "No screening rationale recorded."}</p>
      <dl>
        <div><dt>Next check</dt><dd>{evidence?.kind === "county"
          ? <a href={evidence.href} target="_blank" rel="noopener noreferrer">{review} <span aria-hidden="true">↗</span><span className="sr"> (opens in a new tab)</span></a>
          : review}{missing && <small>{missing}</small>}</dd></div>
        {first ? <FigureRow fact={first} /> : <div><dt>Evidence</dt><dd>No screening figures on file.</dd></div>}
      </dl>
      {others.length > 0 && <details className="disclosure brief-figures">
        <summary className="disclosure">More figures ({others.length})</summary>
        <dl>{others.map(fact => <FigureRow key={fact.label} fact={fact} />)}</dl>
      </details>}
    </section>
  );
}
