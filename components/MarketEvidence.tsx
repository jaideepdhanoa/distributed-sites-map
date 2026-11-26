import { useState } from "react";
import { marketEvidence, formatMarket, workbookSource } from "@/lib/marketContext";
import type { DealProps, SiteProps } from "@/lib/types";

export type WashInspection = {
  radius: 1 | 3 | null; mapped: number | null; select: (miles: 1 | 3) => void;
};

export default function MarketEvidence({deal, site, inspection, expanded = false}: {
  deal?: DealProps | null; site?: SiteProps | null; inspection?: WashInspection; expanded?: boolean;
}) {
  const e = marketEvidence(deal,site);
  const [details,setDetails] = useState(expanded);
  return <section className="market-evidence" aria-label="Market context" data-evidence="market-context">
    <h3>Market context</h3>
    <dl className="market-facts">
      <div><dt>{e.trafficBasis || "Road traffic"}</dt><dd>{formatMarket(e.traffic,"traffic")}<small>vehicles/day</small></dd></div>
      <div><dt>Washes within 1 mi</dt><dd>{formatMarket(e.washes,"washes")}</dd></div>
      <div><dt>Washes within 3 mi</dt><dd>{formatMarket(e.washes3,"washes")}</dd></div>
    </dl>
    {e.trafficNote && <p className="market-source">{e.trafficNote}</p>}
    {inspection && <div className="market-inspect"><span>Map washes within</span>
      <div className="segmented" role="group" aria-label="Map wash radius">{([1,3] as const).map(n =>
        <button type="button" key={n} className={inspection.radius === n ? "segmented on" : "segmented"} aria-pressed={inspection.radius === n}
          onClick={()=>inspection.select(n)}>{n} mi</button>)}</div>
      {inspection.radius && <small>{inspection.mapped == null ? "Checking mapped census locations…" : inspection.mapped + " mapped census locations"} · {workbookSource} counts above</small>}
    </div>}
    <button className="text-link" type="button" aria-expanded={details} onClick={()=>setDetails(!details)}>{details ? "Hide trade-area evidence" : "See trade-area evidence"}</button>
    {details && <div className="market-more">
      <dl><div><dt>Busiest road within 800 m</dt><dd>{formatMarket(e.maximum,"traffic")} vehicles/day</dd></div>
        <div><dt>Population within 3 mi</dt><dd>{formatMarket(e.population,"population")}</dd></div>
        <div><dt>Population growth within 3 mi</dt><dd>{formatMarket(e.growth,"growth")}</dd></div>
        <div><dt>Median household income within 3 mi</dt><dd>{formatMarket(e.income,"income")}</dd></div></dl>
      <p className="market-source">{workbookSource} · {e.growth != null ? "Growth period unavailable · " : ""}— means no reading on file.</p>
      {e.linkedNote && <p className="market-source"><strong>Linked site traffic reading</strong><br/>{e.linkedNote}</p>}
    </div>}
  </section>;
}
