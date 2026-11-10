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
  const [tab, setTab] = useState<TabId>(panel === "discussion" || panel === "numbers" || panel === "activity" ? panel : "overview");
  useEffect(() => {
    if (panel === "discussion" || panel === "numbers" || panel === "activity" || panel === "overview") setTab(panel);
  }, [site, panel]);
  useEffect(() => {
    if (panel !== "discussion" && panel !== "numbers" && panel !== "activity") return;
    const align = () => {
      const node = sections.current;
      const scroller = node?.closest(".drawer-scroll");
      if (!node || !scroller) return;
      const top = node.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      scroller.scrollTo({ top: Math.max(0, top - 4) });
    };
    align();
    const timers = [50, 250, 700].map((delay) => window.setTimeout(align, delay));
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [site, panel, tab]);
  const body = tab === "overview" ? overview : tab === "numbers" ? numbers : tab === "activity" ? activity : discussion;
  return (
    <div className="panel-sections" ref={sections}>
      <div className="panel-tabs" role="tablist" aria-label="Panel sections">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "chip on" : "chip"}
            data-testid={`panel-tab-${id}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{body}</div>
    </div>
  );
}
