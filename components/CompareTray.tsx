import { createPortal } from "react-dom";
import PnlOverlay from "./PnlOverlay";
import { useComparisonStatements } from "./useComparisonStatements";
import { showsFinancials } from "@/lib/keyNumbers";
import { citedWindow, statementFigures, statementMeasures } from "@/lib/pnl/citation";
import type { CitedFigure } from "@/lib/comparisonDecision";
import SaveComparison from "./actions/SaveComparison";
import ComparisonEvidence from "./actions/ComparisonEvidence";
import { evidenceMeasures, evidenceTarget, type EvidenceTarget } from "@/lib/actions/comparisonEvidence";
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
  saveQuery,
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
  saveQuery?: () => string;
  signedIn?: boolean;
  evidenceEnabled?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const [sectionFilter, setSectionFilter] = useState("");
  const [highlight, setHighlight] = useState(true);
  const [gap,setGap] = useState<{target:EvidenceTarget;title:string;label:string;context?:string} | null>(null);
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
  const columns = [
    ...deals.map(deal => ({ id: deal.deal_id, followUps: deal.kind !== "land" && deal.stage_group !== "dropped", targetKind:"deal" as const, deal, title: deal.name || displayAddress(deal.address) || deal.deal_id, rows: dealRows(deal, lookup, signedIn) })),
    ...sites.map(site => ({ id: site.site_id, followUps: !site.land_only, targetKind:"site" as const, deal:(contextDeals || deals).find(d=>d.deal_id===site.linked_deal_id || d.universe_id===site.site_id), title: site.name || displayAddress(site.address) || site.site_id, rows: siteRows(site, contextDeals || deals, signedIn) })),
  ];
  const statementIds = signedIn && hasMatrix ? [...new Set(columns.flatMap(c => c.deal && showsFinancials(c.deal) ? [c.deal.deal_id] : []))].sort().join("|") : "";
  const statements = useComparisonStatements(statementIds);
  const [opened,setOpened] = useState<CitedFigure | null>(null);
  if (!count) return null;
  function statementFor(column: typeof columns[number], anchor?:string) {
    const loaded = column.deal && statements.rows[column.deal.deal_id];
    return loaded ? statementFigures(loaded.pnl,Boolean(loaded.pnlDemo),anchor) : [];
  }
  const options = new Map<string,CitedFigure>();
  for (const column of columns) {
    if (!statementIds) break;
    const applicable = column.deal && showsFinancials(column.deal);
    const loaded = applicable ? statements.rows[column.deal!.deal_id] : null;
    const lines = statementFor(column);
    for (const measure of statementMeasures) {
      const label = evidenceMeasures[measure];
      const line = lines.find(f => f.measure === measure);
      const value = !applicable ? "Not applicable" : loaded === undefined ? "Checking…" : loaded === null ? "Unavailable" : line?.value || MISSING;
      const figure = {targetId:column.id,targetKind:column.targetKind,measure,value,period:line?.period || "",
        basis:line?.basis || "Financial statement",source:line?.source || "Financial statement",anchor:line?.anchor || ""};
      options.set(column.id+"|"+label,figure);
      column.rows.push({label,value:value === MISSING || !line ? value : [value,line.period,line.basis,line.source].join(" · "),
        key:value,basis:[line?.period,line?.basis].join("|")});
    }
  }
  const openColumn = opened && columns.find(c => c.id === opened.targetId);
  const openLine = openColumn && statementFor(openColumn,opened?.anchor).find(f => f.measure === opened?.measure);
  const openData = openColumn?.deal && statements.rows[openColumn.deal.deal_id];
  function openStatement(figure:CitedFigure) {
    inspectedCell.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
    setOpened(figure);
  }
  if (gapQuery) for (const column of columns) {
    const count = coverage?.query === gapQuery ? coverage.counts?.[column.id] : undefined;
    const value = count != null ? String(count) : coverage?.query === gapQuery ? "Unavailable" : "Checking…";
    column.rows.push({label:"Open evidence gaps",key:count,value});
  }
  const measures = comparisonMeasures(columns);
  const decisionMeasures = measures.filter(row => row.label !== "Power" || !signedIn);
  const differences = decisionMeasures.filter(row => row.kind === "different").length;
  const gaps = decisionMeasures.filter(row => row.label !== "Suggested drop" && row.missing > 0);
  const allMissing = gaps.filter(row => row.allMissing);
  const basis = decisionMeasures.filter(row => row.kind === "basis").length;
  const visible = showAll ? measures : decisionMeasures.filter(row => acquisitionCriteria.includes(row.label) || row.label.startsWith("Statement ") || ["different", "gap", "basis"].includes(row.kind));

  const sections = compareSections.filter(section => visible.some(row => row.section === section));
  const selectedSection = sections.find(section => section === sectionFilter) || "";

  function renderCell(column: typeof columns[number], label: string, kind: string, value: string) {
    const row = column.rows.find(row => row.label === label);
    const canFollowUp = column.followUps && column.deal?.kind !== "land" && column.deal?.stage_group !== "dropped";
    const statement = options.get(column.id+"|"+label);
    if (statement && value === "Unavailable") return <button type="button" className="text-link" onClick={statements.retry}>Retry statement</button>;
    if (statement && !["Not applicable","Checking…",MISSING].includes(value)) return <button type="button" className="text-link compare-evidence"
      onClick={()=>openStatement(statement)}>{statement.value}<small>{[statement.period,statement.basis,statement.source].join(" · ")}</small></button>;
    if (value === MISSING) {
      const target = evidenceEnabled && canFollowUp && (statement || evidenceTarget(column.targetKind, column.id, label, column.deal));
      if (!target) return label === "Suggested drop" ? "None recorded" : "Not on file";
      return <>{label === "On-site service" && <strong className="comparison-unconfirmed">Unconfirmed</strong>}<button className="text-link compare-evidence" type="button"
        aria-label={label === "On-site service" ? `Check on-site service for ${column.title}` : `Not on file · Check missing ${label} for ${column.title}`}
        onClick={event => {
          inspectedCell.current = event.currentTarget;
          setGap({target, title:column.title, label});
        }}>{label === "On-site service" ? "Check on-site service" : "Not on file"}</button></>;
    }
    if (!onInspect || kind === "detail" || ["Unavailable", "Checking…", "Not applicable"].includes(value)) return value;
    const pieces = value.split(" · ");
    const power = label === "On-site service" || label === "Street-frontage hosting";
    const primary = power ? String(row?.key || value) : pieces[0];
    const detail = power ? [row?.basis === "Partial" && "Partial service record", row?.source || "Source not recorded"].filter(Boolean).join(" · ") : pieces.slice(1).join(" · ");
    const request = label === "On-site service" && row?.basis !== "Verified" && evidenceEnabled && canFollowUp &&
      evidenceTarget(column.targetKind, column.id, label, column.deal);
    return <><button className="text-link compare-evidence compare-reading" type="button"
      aria-label={`${value} · Inspect ${label} for ${column.title}`}
      onClick={event => {
        inspectedCell.current = event.currentTarget;
        onInspect(column.id, label);
      }}><strong>{primary}</strong>{detail && <small>{detail}</small>}</button>
      {request && <button type="button" className="text-link compare-evidence" onClick={event => {
        inspectedCell.current = event.currentTarget;
        setGap({target:request, title:column.title, label, context:value});
      }}>Check on-site service</button>}</>;
  }

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
        {saveQuery && count >= 2 && onInspect && <SaveComparison key={columns.map(c => c.id).join("|")} query={saveQuery} sites={columns} inspect={onInspect} openStatement={openStatement} revision={refresh}
          checkGap={figure => setGap({ target: figure, title: figure.siteName, label: evidenceMeasures[figure.measure] })}
          figures={columns.flatMap(column => column.rows.flatMap(row => {
            const statement = options.get(column.id+"|"+row.label);
            if (statement) return [{...statement,siteName:column.title}];
            const target = evidenceTarget(column.targetKind, column.id, row.label, column.deal);
            return target
              ? [{ ...target, value: row.value, siteName: column.title, source: row.source || "", ...(["revenue","cash_flow","ebitda"].includes(target.measure) ? {source:column.deal?.figures_source || "Deal record"} : {}) }] : [];
          }))} />}
      </div>
      {count >= 2 ? (
        <>
          <div className="comparison-mode">
            <span role="status">{differences} {differences === 1 ? "decision difference" : "decision differences"} · {gaps.length} {gaps.length === 1 ? "evidence gap" : "evidence gaps"}{basis > 0 && ` · ${basis} with different bases`}{showAll && allMissing.length > 0 && ` · ${allMissing.length} missing for every applicable site`}</span>
            <select className="secondary" aria-label="Comparison section" value={selectedSection} onChange={event => {
              setSectionFilter(event.target.value);
              matrixRef.current?.scrollTo({top:0});
            }}><option value="">All sections</option>{sections.map(section => <option key={section}>{section}</option>)}</select>
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
              {sections.filter(section => !selectedSection || selectedSection === section).map(section => {
                const group = visible.filter(row => row.section === section);
                const order = section === "Acquisition economics" ? ["Asking","Land estimate","Implied business price","Asking / earnings","Business-only multiple","Savings versus hub"] : section === "Financials" ? ["Revenue","Statement revenue","Cash flow","Statement SDE","EBITDA","Statement EBITDA"] : [];
                const rank = (label:string) => order.includes(label) ? order.indexOf(label) : order.length;
                group.sort((a,b) => rank(a.label) - rank(b.label));
                if (!group.length) return null;
                return (
                  <tbody key={section} aria-label={section}>
                    <tr className="comparison-section"><th scope="rowgroup" colSpan={columns.length + 1}>{section}</th></tr>
                    {group.map(({ label, values, kind, available, partial, allMissing }) => (
                      <tr key={label} data-compare-row={label} data-state={kind}>
                        <th scope="row">{label}{label === "Street-frontage hosting" && <small>Utility map at the street</small>}{label === "Implied business price" && <small>Asking less estimated land value</small>}{label === "Business-only multiple" && <small>Implied business price ÷ earnings</small>}{label === "Savings versus hub" && <small>At screening price</small>}{["Revenue","EBITDA","Cash flow"].includes(label) && <small>Deal record</small>}{kind === "basis" && <small>Figures use different measures, periods or bases</small>}{allMissing && label !== "Suggested drop" && <small>Missing for every applicable site</small>}{partial && !(section === "Power evidence" && columns.length === 2) && <small>Available for {available} of {values.filter(value => value !== "Not applicable").length} sites</small>}</th>
                        {values.map((value, i) => (
                          <td key={columns[i].id} className={value === MISSING ? "comparison-missing" : undefined}>
                            {renderCell(columns[i], label, kind, value)}
                            {label === "Cash flow" && value !== MISSING && value !== "Not applicable" && columns[i].deal?.figures_source && <small className="comparison-source">{columns[i].deal?.figures_source}</small>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                );
              })}
            </table>
            {!visible.length && <p className="note">No differing figures to show.</p>}
          </div>
        </>
      ) : null}
      {opened && openData && openLine && openLine.value !== MISSING ? createPortal(<PnlOverlay statement={citedWindow(openData.pnl,opened.anchor || "")!} siteId={openColumn?.deal?.deal_id}
        initialGrain={openLine.selection.grain === "annual" ? "annual" : "monthly"} selection={openLine.selection}
        onClose={()=>{setOpened(null); requestAnimationFrame(()=>inspectedCell.current?.focus({preventScroll:true}));}} />,document.body)
        : opened && openColumn?.deal && !openData ? <section aria-label="Statement evidence"><p role="status">{openData === null ? "Statement unavailable." : "Checking statement…"}</p>
          {openData === null && <button className="text-link" type="button" onClick={statements.retry}>Retry statement</button>}
          <button className="text-link" onClick={()=>setOpened(null)}>Back to comparison</button></section>
        : opened && <ComparisonEvidence target={opened} title={openColumn?.title || opened.targetId}
          context="The cited statement line is unavailable. Check the supporting document."
          saved={()=>setRefresh(n=>n+1)} close={()=>setOpened(null)} inspect={note=>{setOpened(null);onInspect?.(opened.targetId,evidenceMeasures[opened.measure],new URLSearchParams({panel:"discussion",note}));}} />}
      {gap && <ComparisonEvidence target={gap.target} title={gap.title} context={gap.context} close={()=>{setGap(null); requestAnimationFrame(()=>inspectedCell.current?.focus({preventScroll:true}));}} saved={()=>setRefresh(n=>n+1)}
        inspect={note=>{setGap(null);onInspect?.(gap.target.targetId,gap.label,new URLSearchParams({panel:"discussion",note}));}} />}
    </aside>
  );
}
