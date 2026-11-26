import type { SelectionResearch as Research } from "@/lib/selection/research";

const savings = (n:number) => (n*100).toFixed(1)+"%";
const money = new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0});
export default function SelectionResearch({row}:{row:Research}) {
  return <details className="disclosure">
    <summary className="disclosure">Offering and downside · {row.reviewedOn}</summary>
    <p><strong>{row.priority}</strong></p><p>{row.check}</p>
    <dl className="purchase-ledger">
      <div><dt>{row.basis}</dt><dd>{row.quote===null ? "Unpriced" : money.format(row.quote)}</dd></div>
      <div><dt>Offering scope</dt><dd>{row.scope}</dd></div>
    </dl>
    <p>{row.note}</p>
    {row.cases.length>0 && <>
      <table><caption>Modeled savings versus the hub</caption>
        <thead><tr><th scope="col">Stalls</th><th scope="col">Base</th><th scope="col">Conversion stress</th></tr></thead>
        <tbody>{row.cases.map(c=><tr key={c.stalls}><th scope="row">{c.stalls}</th><td>{savings(c.base)}</td><td>{savings(c.stress)}</td></tr>)}</tbody>
      </table>
      <p>Each size is hypothetical. Cases assume 13 hours of host staffing per day and 500 kW of starting service. Stress adds $250,000 of conversion cost and removes $50,000 of annual contribution per site. Target savings are 30%.</p>
    </>}
    {row.source && <a href={row.source} target="_blank" rel="noopener noreferrer">Open source reviewed {row.reviewedOn}</a>}
  </details>;
}
