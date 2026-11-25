import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DealProps, SiteProps } from "@/lib/types";
import { displayAddress } from "@/lib/format";
import { compareSections, comparisonMeasures, dealRows, siteRows, MISSING } from "@/lib/comparison";

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
}: {
  deals: DealProps[];
  sites: SiteProps[];
  contextSites?: SiteProps[];
  contextDeals?: DealProps[];
  inspecting?: boolean;
  onInspect?: (id: string, measure: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
  children?: ReactNode;
  signedIn?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
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
    ...deals.map(deal => ({ id: deal.deal_id, title: deal.name || displayAddress(deal.address) || deal.deal_id, rows: dealRows(deal, lookup, signedIn) })),
    ...sites.map(site => ({ id: site.site_id, title: site.name || displayAddress(site.address) || site.site_id, rows: siteRows(site, contextDeals || deals, signedIn) })),
  ];
  const measures = comparisonMeasures(columns);
  const differences = measures.filter(row => row.kind === "different").length;
  const gaps = measures.filter(row => row.kind === "gap").length;
  const basis = measures.filter(row => row.kind === "basis").length;
  const visible = showAll ? measures : measures.filter(row => ["different", "gap", "basis"].includes(row.kind));
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
            {(showAll || visible.length < measures.length) && (
              <button type="button" className="text-link" aria-expanded={showAll} aria-controls="comparison-facts" onClick={() => setShowAll(value => !value)}>
                {showAll ? "Show differences" : "Show all measures"}
              </button>
            )}
          </div>
          <div className="comparison-scroll" id="comparison-facts" ref={matrixRef} tabIndex={0} aria-label="Comparison facts">
            <table className="comparison-table" data-sites={columns.length}>
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
                        {values.map((value, i) => (
                          <td key={columns[i].id} className={value === MISSING ? "comparison-missing" : undefined}>
                            {kind !== "detail" && value !== MISSING && onInspect ? <button className="text-link compare-evidence" type="button" aria-label={`Inspect ${label} for ${columns[i].title}`} onClick={event => {
                              inspectedCell.current = event.currentTarget;
                              onInspect(columns[i].id, label);
                            }}>{value}</button> : value !== MISSING ? value : label === "Suggested drop" ? "None recorded" : "Not on file"}
                          </td>
                        ))}
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
    </aside>
  );
}
