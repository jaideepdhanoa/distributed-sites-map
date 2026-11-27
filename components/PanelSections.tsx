"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { numberEvidence } from "@/lib/comparison";
import { currentSearch, rememberSearch } from "@/lib/navSearch";

const TABS = [
  ["overview", "Overview"],
  ["numbers", "Site fit"],
  ["market-context", "Market"],
  ["purchase", "Financials"],
  ["discussion", "Diligence"],
  ["activity", "Activity"],
] as const;

type TabId = (typeof TABS)[number][0];

function recordTab(panel: string | null): TabId {
  if (panel === "proposal") return "discussion";
  if (panel === "economics") return "purchase";
  if (panel === "open-land" || panel === "space-options") return "numbers";
  return TABS.find(([id])=>id===panel)?.[0] || "overview";
}

export default function PanelSections({
  overview,
  economics,
  purchase,
  market,
  numbers,
  activity,
  discussion,
  workflow,
}: {
  purchase?: ReactNode;
  overview: ReactNode;
  economics: ReactNode;
  market: ReactNode;
  numbers: ReactNode;
  activity: ReactNode;
  discussion: ReactNode;
  workflow: ReactNode;
}) {
  const params = useSearchParams();
  const site = params.get("site");
  const panel = params.get("panel");
  const sections = useRef<HTMLDivElement>(null);
  const note = params.get("note");
  const measure = params.get("measure") || "";
  const tab = recordTab(panel);
  useEffect(() => {
    const node = sections.current;
    const scroller = node?.closest(".drawer-scroll");
    if (!node || !(scroller instanceof HTMLElement)) return;
    // Ordinary tab changes open at the beginning. Only evidence links need to
    // track the position of asynchronously loaded details.
    if (panel === "proposal" || panel === "finding") return;
    if (!measure && !note && panel !== "space-options" && panel !== "open-land") {
      scroller.scrollTop = 0;
      return;
    }
    let frame = 0;
    const align = () => {
      const evidence = panel === "space-options" ? "space-options" : panel === "market-context" ? "market-context" : panel === "open-land" ? "open-land" : panel === "numbers" ? numberEvidence[measure] : "";
      const target = evidence ? node.querySelector<HTMLElement>(`[data-evidence="${CSS.escape(evidence)}"]`)
        : panel === "economics" && measure ? node.querySelector<HTMLElement>(`[data-financial-measure="${CSS.escape(measure)}"]`)
        : panel === "discussion" && note ? node.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(note)}"]`) : null;
      if (target) {
        for (let parent: HTMLElement | null = target; parent && parent !== node; parent = parent.parentElement) {
          if (parent instanceof HTMLDetailsElement && !parent.open) parent.open = true;
        }
      }
      const top = (target || node).getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const next = Math.max(0, top - 8);
      if (Math.abs(scroller.scrollTop - next) > 2) scroller.scrollTo({ top: next });
    };
    const sizes = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(align);
    });
    const watch = (element: Element) => sizes.observe(element);
    watch(scroller);
    for (const child of scroller.children) watch(child);
    const added = new MutationObserver(() => {
      for (const child of scroller.children) watch(child);
      align();
    });
    added.observe(scroller, { childList: true, subtree: true });
    align();
    const stopTracking = () => {
      cancelAnimationFrame(frame);
      sizes.disconnect();
      added.disconnect();
    };
    const stop = window.setTimeout(stopTracking, 8000);
    const events = ["wheel", "touchstart", "pointerdown", "keydown"];
    events.forEach(event => scroller.addEventListener(event, stopTracking, { passive: true }));
    return () => {
      stopTracking();
      window.clearTimeout(stop);
      events.forEach(event => scroller.removeEventListener(event, stopTracking));
    };
  }, [site, panel, note, measure]);
  const panels = { purchase:<>{purchase}{economics}</>, "market-context":market, overview, numbers, activity, discussion: <>{workflow}{tab === "discussion" && discussion}</> };
  const intel = panel === "intel";
  return (
    <div className="panel-sections" ref={sections}>
      {intel ? (
        <section id="panel-intel" data-testid="intel-panel">
          <p className="eyebrow">Intel</p>
          <p className="layer-meta">No intel is recorded for this site.</p>
        </section>
      ) : null}
      {TABS.filter(([id]) => id === tab || id === "numbers" || id === "discussion").map(([id]) => (
        <div key={id} id={`panel-${id}`} role="tabpanel" aria-labelledby={`record-tab-${id}`} hidden={tab !== id}>
          {panels[id]}
        </div>
      ))}
    </div>
  );
}

export function chooseRecordTab(id: TabId) {
  const next = new URLSearchParams(currentSearch().replace(/^\?/, ""));
  const shown = next.get("panel") || "overview";
  if (shown === id && (id === "activity" || !next.get("msg"))) return;
  next.delete("q");
  if (id !== "activity") next.delete("msg");
  if (id !== "discussion") next.delete("note");
  if (id === "overview") next.delete("panel");
  else next.set("panel", id);
  const href = next.toString() ? `/?${next.toString()}` : "/";
  rememberSearch(href);
  window.history.replaceState(null, "", href);
}

export function RecordNavigation({financials=false}:{financials?:boolean} = {}) {
  const params = useSearchParams();
  const panel = params.get("panel");
  const tab = recordTab(panel);
  const tabs=TABS.filter(([id])=>id!=="purchase" || financials);
  const rail = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = rail.current;
    const selected = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !selected) return;
    const edge = selected.getBoundingClientRect();
    const frame = list.getBoundingClientRect();
    if (edge.right > frame.right) list.scrollLeft += edge.right - frame.right;
    if (edge.left < frame.left) list.scrollLeft += edge.left - frame.left;
  }, [tab]);

  return (
      <div ref={rail} className="panel-tabs" role="tablist" aria-label="Panel sections">
        {tabs.map(([id, label], index) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`record-tab-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onKeyDown={event => {
              const next = event.key === "ArrowRight" ? (index+1)%tabs.length : event.key === "ArrowLeft" ? (index+tabs.length-1)%tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length-1 : -1;
              if (next < 0) return;
              event.preventDefault();
              const dest = tabs[next][0];
              document.getElementById("record-tab-"+dest)?.focus();
              chooseRecordTab(dest);
            }}
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            className={tab === id ? "chip on" : "chip"}
            data-testid={`panel-tab-${id}`}
            onClick={() => chooseRecordTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
  );
}
