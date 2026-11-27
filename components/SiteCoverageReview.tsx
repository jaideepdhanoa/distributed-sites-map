import type { SiteCoverage } from "@/lib/selection/opportunity";

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const perCharge = (value: number | null) => value === null ? "Pending" : "$" + value.toFixed(2);

export default function SiteCoverageReview({ evidence }: { evidence: SiteCoverage }) {
  const { cases } = evidence;
  return <details className="disclosure site-coverage">
    <summary className="disclosure">Parcel, space and charging evidence</summary>
    <p><small>Evidence checked {evidence.reviewedOn}</small></p>
    <h4>Parcel · {evidence.countyStatus}</h4><p>{evidence.county}</p>
    {evidence.countySource && <a className="text-link" href={evidence.countySource} target="_blank" rel="noreferrer">Official county record ↗</a>}
    <h4>Usable space · {evidence.spaceStatus}</h4><p>{evidence.space}</p>
    <a className="text-link" href={evidence.layoutSource}>Inspect the layout</a>
    <h4>Charging economics · {evidence.financeStatus}</h4><p>{evidence.finance}</p>
    {cases.length > 0 && <>
      <table><caption>Hypothetical footprints · Moove-paid staff</caption>
        <thead><tr><th scope="col">Stalls</th><th scope="col">Base / charge</th><th scope="col">Downside / charge</th><th scope="col">Downside price ceiling</th></tr></thead>
        <tbody>{cases.map(row => <tr key={row.stalls}><th scope="row">{row.stalls}</th><td>{perCharge(row.base)}</td><td>{perCharge(row.downside)}</td>
          <td>{row.ceiling < 0 ? "No positive price" : dollars.format(row.ceiling)}</td></tr>)}</tbody></table>
      <p><small>{cases[0].price !== null && <>Tested price {dollars.format(cases[0].price)}. </>}
        The ceiling is parity with the filed depot reference. Confirm local power, retained cash, usable stalls and fleet demand before an offer.</small></p>
    </>}
    <p><b>Next decision</b> · {evidence.next}</p>
    <a className="text-link" href={evidence.source} target="_blank" rel="noreferrer">Source record ↗</a>
  </details>;
}
