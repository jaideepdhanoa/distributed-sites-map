import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { inMapArea, type MapArea } from "@/lib/geoFilter";
import { formatMarket, marketColor, marketColors, marketMeasures, missingColor, sortMarketRows, type MarketMetric, type MarketRow } from "@/lib/marketContext";

type Props = {
  metric: MarketMetric; choose: (metric: MarketMetric | null) => void; rows: MarketRow[]; area: MapArea | null;
  clustered: boolean;
  missingLocations: number;
  showMissing: () => void;
  pick: (id: string) => void; spot: (point: [number,number] | null) => void;
};

export default function MarketMapPanel({metric, choose, rows, area, pick, spot, clustered, missingLocations, showMissing}: Props) {
  const [open, setOpen] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches);
  const [limit,setLimit] = useState(12);
  const [sort,setSort] = useState<{key:MarketMetric; desc:boolean} | null>(null);
  useEffect(()=>()=>spot(null),[spot]);
  const measure = marketMeasures[metric];
  const inView = rows.filter(row=>inMapArea(...row.point,area));
  const sortKey = sort?.key ?? metric, desc = sort?.desc ?? metric !== "washes";
  const ordered = sortMarketRows(inView,sortKey,desc);
  const known = inView.filter(row=>row.evidence[metric] != null).length;
  const trade = metric !== "traffic" && metric !== "washes";
  const columns: MarketMetric[] = trade ? [metric,"washes"] : ["traffic","washes"];
  function change(next: MarketMetric) { setSort(null); setLimit(12); choose(next); }
  function header(key: MarketMetric) {
    const label = key === "traffic" ? "Vehicles/day" : key === "washes" ? "Washes · 1 mi" : marketMeasures[key].title;
    return <th key={key} scope="col" aria-sort={sortKey !== key ? "none" : desc ? "descending" : "ascending"}>
      <button type="button" className="sort-header" onClick={()=>setSort({key,desc:sortKey === key ? !desc : key !== "washes"})}>{label}{sortKey === key ? (desc ? " ↓" : " ↑") : ""}</button>
    </th>;
  }
  return <aside className="market-panel" aria-label="Market context map">
    <header><h2>Market context</h2><button type="button" className="close" aria-label="Close market context" onClick={()=>choose(null)}>×</button></header>
    <div className="segmented market-tabs" role="group" aria-label="Market measure">
      {([["traffic","Traffic"],["washes","Nearby washes"],["population","Trade area"]] as const).map(([key,label])=>{
        const active = key === metric || (key === "population" && trade);
        return <button type="button" key={key} className={active ? "segmented on" : "segmented"} aria-pressed={active} onClick={()=>change(key)}>{label}</button>;
      })}
    </div>
    {trade && <select className="secondary" aria-label="Trade-area measure" value={metric} onChange={event=>change(event.target.value as MarketMetric)}>
      {(["population","growth","income"] as const).map(key=><option key={key} value={key}>{marketMeasures[key].title} · 3 miles</option>)}</select>}
    <p className="market-unit">{measure.title} · {measure.unit}</p>
    <div className="market-legend">{[...measure.bands,"Missing"].map((label,i)=><span key={label}><i style={{background:marketColors[i] || missingColor}}/>{label}</span>)}</div>
    {clustered && <p className="market-unit">Group labels show readings / mapped sites.</p>}
    {missingLocations > 0 && <button type="button" className="text-link market-unplaced only-mobile" onClick={showMissing}>{missingLocations} {missingLocations === 1 ? "site needs" : "sites need"} a location</button>}
    <button type="button" className="paper-btn market-view-toggle" aria-expanded={open} onClick={()=>{setOpen(!open);spot(null);}}>
      <span>Sites in view <b>{inView.length}</b></span><small>{known} with data</small><ChevronDown size={16}/></button>
    {open && <div className="market-table-scroll">
      {inView.length ? <table><thead><tr><th scope="col">Site</th>{columns.map(header)}</tr></thead>
        <tbody>{ordered.slice(0,limit).map(row=><tr key={row.id} onMouseEnter={()=>spot(row.point)} onMouseLeave={()=>spot(null)}>
          <th scope="row"><button className="text-link" type="button" data-market-site={row.id} onFocus={()=>spot(row.point)} onBlur={()=>spot(null)} onClick={()=>pick(row.id)}>
            <i style={{background:marketColor(metric,row.evidence[metric])}}/>{row.name}</button></th>
          {columns.map(key=><td key={key}>{formatMarket(row.evidence[key],key)}{key === "traffic" && row.evidence.trafficBasis === "Site traffic record" && <small>Site reading</small>}</td>)}
        </tr>)}</tbody></table> : <p>No matching sites in this map area.</p>}
      {ordered.length > limit && <button type="button" className="text-link" onClick={()=>setLimit(limit+24)}>Show more sites</button>}
    </div>}
  </aside>;
}
