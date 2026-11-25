"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { currentSearch, rememberSearch } from "@/lib/navSearch";

const TABS = [
  ["overview", "Summary"],
  ["numbers", "Space and power"],
  ["discussion", "Discussion"],
  ["activity", "Activity"],
] as const;

type TabId = (typeof TABS)[number][0];

export default function PanelSections({
  overview,
  numbers,
  activity,
  discussion,
}: {
  overview: ReactNode;
  numbers: ReactNode;
  activity: ReactNode;
  discussion: ReactNode;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const site = params.get("site");
  const panel = params.get("panel");
  const sections = useRef<HTMLDivElement>(null);
  const note = params.get("note");
  const tab: TabId = panel === "open-land" ? "numbers" : panel === "discussion" || panel === "numbers" || panel === "activity" ? panel : "overview";
  useEffect(() => {
    if (panel !== "open-land" && panel !== "discussion" && panel !== "numbers" && panel !== "activity") return;
    const node = sections.current;
    const scroller = node?.closest(".drawer-scroll");
    if (!node || !(scroller instanceof HTMLElement)) return;
    let frame = 0;
    const align = () => {
      const target = panel === "open-land" ? node.querySelector<HTMLElement>('[data-evidence="open-land"]')
        : panel === "discussion" && note ? node.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(note)}"]`) : null;
      if (target) {
        for (let parent: HTMLElement | null = target; parent && parent !== node; parent = parent.parentElement) {
          if (parent instanceof HTMLDetailsElement && !parent.open) parent.open = true;
        }
      }
      const top = (target || node).getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const next = Math.max(0, top - 4);
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
  }, [site, panel, note]);
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
    router.replace(href, { scroll: false });
  }
  const panels = { overview, numbers, activity, discussion };
  const intel = panel === "intel";
  return (
    <div className="panel-sections" ref={sections}>
      {intel ? (
        <section id="panel-intel" data-testid="intel-panel">
          <p className="eyebrow">Intel</p>
          <p className="layer-meta">No intel is recorded for this site.</p>
        </section>
      ) : null}
      <div className="panel-tabs" role="tablist" aria-label="Panel sections">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
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
      {TABS.filter(([id]) => id === tab || id === "numbers").map(([id]) => (
        <div key={id} id={`panel-${id}`} role="tabpanel" hidden={tab !== id}>
          {panels[id]}
        </div>
      ))}
    </div>
  );
}
