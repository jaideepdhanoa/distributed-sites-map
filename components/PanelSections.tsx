"use client";

import { useState, type ReactNode } from "react";

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
  const [tab, setTab] = useState<TabId>("overview");
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
            className={tab === id ? "on" : ""}
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
