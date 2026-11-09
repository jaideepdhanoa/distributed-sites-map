"use client";

import { useEffect, useState, type ReactNode } from "react";
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
  const [tab, setTab] = useState<TabId>(panel === "discussion" || panel === "numbers" || panel === "activity" ? panel : "overview");
  useEffect(() => {
    if (panel === "discussion" || panel === "numbers" || panel === "activity" || panel === "overview") setTab(panel);
  }, [site, panel]);
  const body = tab === "overview" ? overview : tab === "numbers" ? numbers : tab === "activity" ? activity : discussion;
  return (
    <div className="panel-sections">
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
