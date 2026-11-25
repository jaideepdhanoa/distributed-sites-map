import { screeningEvidence } from "@/lib/screeningEvidence";

export default function RecordBrief(input: Parameters<typeof screeningEvidence>[0]) {
  const { status, reason, review, missing, figures } = screeningEvidence(input);
  const fact = figures[0];
  return (
    <section className="record-brief" aria-label="Screening decision">
      <div className="brief-decision"><span>Screening decision</span><strong>{status}</strong></div>
      <p>{reason || "No screening rationale recorded."}</p>
      <dl>
        <div><dt>Next check</dt><dd>{review}{missing && <small>{missing}</small>}</dd></div>
        {fact ? <div><dt>{fact.label}</dt><dd>{fact.value}<small>{fact.source || "Source not recorded"} · {fact.date || "Date not recorded"}</small></dd></div>
          : <div><dt>Evidence</dt><dd>No screening figures on file.</dd></div>}
      </dl>
    </section>
  );
}
