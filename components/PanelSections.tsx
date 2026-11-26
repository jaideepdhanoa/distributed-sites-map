"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { numberEvidence } from "@/lib/comparison";
import { currentSearch, rememberSearch } from "@/lib/navSearch";

const TABS = [
  ["overview", "Record"],
  ["numbers", "Site fit"],
  ["economics", "Economics"],
  ["purchase", "Financials"],
  ["discussion", "Diligence"],
  ["activity", "Activity"],
] as const;

type TabId = (typeof TABS)[number][0];

function recordTab(panel: string | null): TabId {
  return panel === "open-land" ? "numbers" : panel === "purchase" || panel === "economics" || panel === "discussion" || panel === "numbers" || panel === "activity" ? panel : "overview";
}

export default function PanelSections({
  overview,
  economics,
  purchase,
  numbers,
  activity,
  discussion,
}: {
  purchase?: ReactNode;
  overview: ReactNode;
  economics: ReactNode;
  numbers: ReactNode;
  activity: ReactNode;
  discussion: ReactNode;
}) {
  const params = useSearchParams();
  const site = params.get("site");
  const panel = params.get("panel");
  const sections = useRef<HTMLDivElement>(null);
  const note = params.get("note");
  const measure = params.get("measure") || "";
  const tab = recordTab(panel);
  useEffect(() => {
    if (panel !== "purchase" && panel !== "economics" && panel !== "open-land" && panel !== "discussion" && panel !== "numbers" && panel !== "activity") return;
    const node = sections.current;
    const scroller = node?.closest(".drawer-scroll");
    if (!node || !(scroller instanceof HTMLElement)) return;
    let frame = 0;
    const align = () => {
      const evidence = panel === "open-land" ? "open-land" : panel === "numbers" ? numberEvidence[measure] : "";
      const target = evidence ? node.querySelector<HTMLElement>(`[data-evidence="${CSS.escape(evidence)}"]`)
        : panel === "economics" && measure ? node.querySelector<HTMLElement>(`[data-financial-measure="${CSS.escape(measure)}"]`)
        : panel === "discussion" && note ? node.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(note)}"]`) : null;
      if (target) {
        for (let parent: HTMLElement | null = target; parent && parent !== node; parent = parent.parentElement) {
          if (parent instanceof HTMLDetailsElement && !parent.open) parent.open = true;
        }
      }
      const top = (target || node).getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const navigation = scroller.querySelector<HTMLElement>(":scope > .panel-tabs");
      const next = Math.max(0, top - (navigation?.offsetHeight || 0) - 8);
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
    const stop = window.setTimeout(() => {
      sizes.disconnect();
      added.disconnect();
    }, 8000);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(stop);
      sizes.disconnect();
      added.disconnect();
    };
  }, [site, panel, note, measure]);
  const panels = { purchase:purchase || <p>Operating financials are not applicable to this record.</p>, economics, overview, numbers, activity, discussion };
  const intel = panel === "intel";
  return (
    <div className="panel-sections" ref={sections}>
      {intel ? (
        <section id="panel-intel" data-testid="intel-panel">
          <p className="eyebrow">Intel</p>
          <p className="layer-meta">No intel is recorded for this site.</p>
        </section>
      ) : null}
      {TABS.filter(([id]) => id === tab || id === "numbers").map(([id]) => (
        <div key={id} id={`panel-${id}`} role="tabpanel" aria-labelledby={`record-tab-${id}`} hidden={tab !== id}>
          {panels[id]}
        </div>
      ))}
    </div>
  );
}

export function RecordNavigation({financials=false}:{financials?:boolean} = {}) {
  const params = useSearchParams();
  const panel = params.get("panel");
  const tab = recordTab(panel);
  const tabs=TABS.filter(([id])=>id!=="purchase" || financials);
  function chooseTab(id: TabId) {
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
  return (
      <div className="panel-tabs" role="tablist" aria-label="Panel sections">
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
              chooseTab(dest);
            }}
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            className={tab === id ? "chip on" : "chip"}
            data-testid={`panel-tab-${id}`}
            onClick={() => chooseTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
  );
}
