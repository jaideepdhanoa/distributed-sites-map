"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

const TABS = [
  ["overview", "Overview"],
  ["numbers", "Numbers"],
  ["activity", "Activity"],
  ["discussion", "Discussion"],
] as const;

type TabId = (typeof TABS)[number][0];

const openTab = new Map<string, TabId>();

function tabHref(current: { toString(): string }, id: TabId) {
  const next = new URLSearchParams(current.toString());
  if (id === "overview") next.delete("panel");
  else next.set("panel", id);
  const query = next.toString();
  return query ? `/?${query}` : "/";
}

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
  const site = params.get("site");
  const panel = params.get("panel");
  const sections = useRef<HTMLDivElement>(null);
  const fromUrl = panel === "discussion" || panel === "numbers" || panel === "activity" ? panel : "overview";
  const [tab, setTab] = useState<TabId>((site && openTab.get(site)) || fromUrl);
  useEffect(() => {
    const remembered = site ? openTab.get(site) : undefined;
    if (remembered) setTab(remembered);
    else if (panel === "discussion" || panel === "numbers" || panel === "activity" || panel === "overview") setTab(panel);
  }, [site, panel]);
  function choose(id: TabId) {
    if (site) openTab.set(site, id);
    setTab(id);
  }
  useEffect(() => {
    if (panel !== "discussion" && panel !== "numbers" && panel !== "activity") return;
    const node = sections.current;
    const scroller = node?.closest(".drawer-scroll");
    if (!node || !(scroller instanceof HTMLElement)) return;
    let frame = 0;
    const align = () => {
      const top = node.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
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
  }, [site, panel, tab]);
  const body = tab === "overview" ? overview : tab === "numbers" ? numbers : tab === "activity" ? activity : discussion;
  return (
    <div className="panel-sections" ref={sections}>
      <div className="panel-tabs" role="tablist" aria-label="Panel sections">
        {TABS.map(([id, label]) => (
          <a
            key={id}
            href={tabHref(params, id)}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "chip on" : "chip"}
            data-testid={`panel-tab-${id}`}
            onClick={(event) => {
              event.preventDefault();
              choose(id);
            }}
          >
            {label}
          </a>
        ))}
      </div>
      <div role="tabpanel">{body}</div>
    </div>
  );
}
