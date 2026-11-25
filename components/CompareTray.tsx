import ComparisonEvidence from "./actions/ComparisonEvidence";
import { evidenceTarget, type EvidenceTarget } from "@/lib/actions/comparisonEvidence";
import { csvCell } from "@/lib/actions/text";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DealProps, SiteProps } from "@/lib/types";
import { displayAddress } from "@/lib/format";
import { acquisitionCriteria, compareSections, comparisonMeasures, dealRows, siteRows, MISSING } from "@/lib/comparison";

export default function CompareTray({
  deals,
  sites,
  contextSites,
  contextDeals,
  onRemove,
  inspecting = false,
  onInspect,
  onClose,
  children,
  signedIn = false,
  evidenceEnabled = false,
}: {
  deals: DealProps[];
  sites: SiteProps[];
  contextSites?: SiteProps[];
  contextDeals?: DealProps[];
  inspecting?: boolean;
  onInspect?: (id: string, measure: string, source?: URLSearchParams) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
  children?: ReactNode;
  signedIn?: boolean;
  evidenceEnabled?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const [highlight, setHighlight] = useState(true);
  const [gap,setGap] = useState<{target:EvidenceTarget;title:string;label:string} | null>(null);
  const lookup = contextSites || sites;
  const count = deals.length + sites.length;
  const matrixRef = useRef<HTMLDivElement>(null);
  const inspectedCell = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!inspecting && inspectedCell.current?.isConnected) {
      inspectedCell.current.focus({ preventScroll: true });
      inspectedCell.current.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [inspecting]);
  const hasMatrix = count >= 2;
  const gapQuery = hasMatrix && signedIn ? new URLSearchParams([...deals.map(d=>d.deal_id),...sites.map(s=>s.site_id)].map(id=>["site",id])).toString() : "";
  const [coverage,setCoverage] = useState<{query:string; counts:Record<string,number>|null}>();
  const [refresh,setRefresh] = useState(0);
  useEffect(()=>{
    if (!gapQuery || inspecting) return;
    const controller = new AbortController();
    fetch("/api/actions/work?"+gapQuery,{signal:controller.signal,cache:"no-store"}).then(async response=>{
      if (!response.ok) throw Error();
      const {counts} = await response.json();
      if (!controller.signal.aborted) setCoverage({query:gapQuery,counts});
    }).catch(()=>{if (!controller.signal.aborted) setCoverage({query:gapQuery,counts:null});});
    return ()=>controller.abort();
  },[gapQuery,refresh,inspecting]);
  useEffect(() => {
    if (!hasMatrix) return;
    const trigger = document.activeElement;
    matrixRef.current?.focus({ preventScroll: true });
    return () => {
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [hasMatrix]);
  if (!count) return null;
  const columns = [
    ...deals.map(deal => ({ id: deal.deal_id, targetKind:"deal" as const, deal, title: deal.name || displayAddress(deal.address) || deal.deal_id, rows: dealRows(deal, lookup, signedIn) })),
    ...sites.map(site => ({ id: site.site_id, targetKind:"site" as const, deal:(contextDeals || deals).find(d=>d.deal_id===site.linked_deal_id || d.universe_id===site.site_id), title: site.name || displayAddress(site.address) || site.site_id, rows: siteRows(site, contextDeals || deals, signedIn) })),
  ];
  if (gapQuery) for (const column of columns) {
    const count = coverage?.query === gapQuery ? coverage.counts?.[column.id] : undefined;
    const value = count != null ? String(count) : coverage?.query === gapQuery ? "Unavailable" : "Checking…";
    column.rows.push({label:"Open evidence gaps",key:count,value});
  }
  const measures = comparisonMeasures(columns);
  const differences = measures.filter(row => row.kind === "different").length;
  const gaps = measures.filter(row => row.kind === "gap").length;
  const basis = measures.filter(row => row.kind === "basis").length;
  const visible = showAll ? measures : measures.filter(row => acquisitionCriteria.includes(row.label) || ["different", "gap", "basis"].includes(row.kind));
  return (
    <aside hidden={inspecting} className="compare-tray" data-testid="compare-tray">
      <div className="compare-bar">
        <h2>Compare sites</h2>
        {deals.map((deal) => (
          <button key={deal.deal_id} type="button" aria-label={`Remove ${deal.name || deal.address} from comparison`} onClick={() => onRemove(deal.deal_id)} className="menu-item">
            {deal.name || deal.address}
            <span aria-hidden="true"> ×</span>
          </button>
        ))}
        {sites.map((site) => (
          <button key={site.site_id} type="button" aria-label={`Remove ${site.name || site.address} from comparison`} onClick={() => onRemove(site.site_id)} className="menu-item">
            {site.name || site.address}
            <span aria-hidden="true"> ×</span>
          </button>
        ))}
        <span className="layer-meta" role="status">{count} of 4 selected{count === 1 ? " · Select another site" : count === 4 ? " · Remove one to add another" : ""}</span>
        <button type="button" className="close" aria-label="Close compare" onClick={onClose}><span aria-hidden="true">×</span></button>
        {children}
      </div>
      {count >= 2 ? (
        <>
          <div className="comparison-mode">
            <span role="status">{differences} {differences === 1 ? "decision difference" : "decision differences"} · {gaps} one-sided {gaps === 1 ? "gap" : "gaps"}{basis > 0 && ` · ${basis} with different bases`}</span>
            {coverage?.query === gapQuery && coverage.counts === null && <button type="button" className="text-link" onClick={()=>setRefresh(n=>n+1)}>Retry gap counts</button>}
            <label className="act-check"><input type="checkbox" className="check" checked={highlight} onChange={e=>setHighlight(e.target.checked)} />Highlight differences</label>
            <button type="button" className="text-link" onClick={()=>{
              const capturedAt = new Date().toISOString();
              const lines = [
                ["Captured at", capturedAt],
                ["Record ID", "", ...columns.map(column => column.id)],
                ["Section", "Measure", ...columns.map(column => column.title)],
                ...measures.map(row => [row.section, row.label, ...row.values.map(value => value === MISSING ? "Not on file" : value)]),
              ];
              const csv = lines.map(line=>line.map(csvCell).join(",")).join("\r\n");
              const url = URL.createObjectURL(new Blob(["\uFEFF",csv],{type:"text/csv;charset=utf-8"}));
              const link = document.createElement("a");
              link.href = url;
              link.download = "site-comparison-"+capturedAt.slice(0,10)+".csv";
              link.click();
              window.setTimeout(()=>URL.revokeObjectURL(url),1000);
            }}>Download dated snapshot</button>
            {(showAll || visible.length < measures.length) && (
              <button type="button" className="text-link" aria-expanded={showAll} aria-controls="comparison-facts" onClick={() => setShowAll(value => !value)}>
                {showAll ? "Show decision criteria" : "Show all measures"}
              </button>
            )}
          </div>
          <div className="comparison-scroll" id="comparison-facts" ref={matrixRef} tabIndex={0} aria-label="Comparison facts">
            <table className="comparison-table" data-highlight={highlight} data-sites={columns.length}>
              <caption className="sr">Site comparison</caption>
              <thead><tr><th scope="col">Measure</th>{columns.map(column => <th scope="col" key={column.id}>{column.title}</th>)}</tr></thead>
              {compareSections.map(section => {
                const group = visible.filter(row => row.section === section);
                if (!group.length) return null;
                return (
                  <tbody key={section} aria-label={section}>
                    <tr className="comparison-section"><th scope="rowgroup" colSpan={columns.length + 1}>{section}</th></tr>
                    {group.map(({ label, values, kind }) => (
                      <tr key={label} data-compare-row={label} data-state={kind}>
                        <th scope="row">{label}{kind === "basis" && <small>Different bases</small>}{kind === "gap" && <small>Evidence gap</small>}</th>
                        {values.map((value, i) => {
                          const column = columns[i];
                          const target = value === MISSING && evidenceEnabled ? evidenceTarget(column.targetKind,column.id,label,column.deal) : undefined;
                          return (
                          <td key={columns[i].id} className={value === MISSING ? "comparison-missing" : undefined}>
                            {target ? <button className="text-link compare-evidence" type="button" aria-label={`Check missing ${label} for ${column.title}`} onClick={event=>{
                              inspectedCell.current = event.currentTarget;
                              setGap({target,title:column.title,label});
                            }}>Not on file</button> : kind !== "detail" && value !== MISSING && !["Unavailable","Checking…","Not applicable"].includes(value) && onInspect ? <button className="text-link compare-evidence" type="button" aria-label={`Inspect ${label} for ${columns[i].title}`} onClick={event => {
                              inspectedCell.current = event.currentTarget;
                              onInspect(columns[i].id, label);
                            }}>{value}</button> : value !== MISSING ? value : label === "Suggested drop" ? "None recorded" : "Not on file"}
                          </td>
                        );})}
                      </tr>
                    ))}
                  </tbody>
                );
              })}
            </table>
            {!visible.length && <p className="note">No decision differences or one-sided gaps in the recorded measures.</p>}
          </div>
        </>
      ) : null}
      {gap && <ComparisonEvidence target={gap.target} title={gap.title} close={()=>setGap(null)} saved={()=>setRefresh(n=>n+1)}
        inspect={note=>{setGap(null);onInspect?.(gap.target.targetId,gap.label,new URLSearchParams({panel:"discussion",note}));}} />}
    </aside>
  );
}
