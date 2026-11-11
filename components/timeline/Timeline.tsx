"use client";

import { useEffect, useState } from "react";
import "./timeline.css";

type Item = { date: string; type: string; summary: string };
type Material = { category: string; label: string; count: number; latest: string };
type Payload = {
  folderUrl?: string;
  materials?: Material[];
  lastTouched?: string;
  items?: Item[];
  showActivityLines?: boolean;
};

const LABELS: Record<string, string> = {
  listing: "Listing",
  brochure: "Brochure",
  om: "OM",
  financials: "Financials",
  photos: "Photos",
  legal: "Property and legal",
  doc: "Document",
  visit: "Visit",
  stage: "Stage",
  bring_back: "Brought back",
  drop_suggested: "Suggested drop",
  drop: "Dropped",
};

const KEPT_LINES = new Set(["bring_back", "drop_suggested", "drop"]);

export default function Timeline({ recordId, relatedId }: { recordId: string; relatedId?: string }) {
  const [payload, setPayload] = useState<Payload | null>(null);

  useEffect(() => {
    let cancel = false;
    const query = new URLSearchParams({ id: recordId });
    if (relatedId) query.set("related", relatedId);
    async function load() {
      try {
        const response = await fetch(`/api/data/timeline?${query}`);
        const next = response.ok ? ((await response.json()) as Payload) : {};
        if (!cancel) setPayload(next);
      } catch {
        if (!cancel) setPayload({});
      }
    }
    void load();
    const refresh = () => {
      void load();
    };
    window.addEventListener("queue-refresh", refresh);
    return () => {
      cancel = true;
      window.removeEventListener("queue-refresh", refresh);
    };
  }, [recordId, relatedId]);

  const materials = payload?.materials || [];
  const items = (payload?.items || []).filter((item) => KEPT_LINES.has(item.type) || payload?.showActivityLines !== false);
  const folderUrl = payload?.folderUrl || "";
  const lastTouched = payload?.lastTouched || "";
  const empty = payload !== null && !folderUrl && materials.length === 0 && !lastTouched && items.length === 0;

  return (
    <section className="tl" data-testid="activity">
      <h3>Activity</h3>
      {payload === null ? <p className="note">Loading activity.</p> : null}
      {empty ? <p className="note">No materials on file.</p> : null}
      {folderUrl ? (
        <p><a href={folderUrl} target="_blank" rel="noopener noreferrer">Open site folder</a></p>
      ) : null}
      {materials.length ? (
        <ul className="tl-list">
          {materials.map((item) => (
            <li key={item.category}>{item.label} ({item.count}){item.latest ? ` · ${item.latest}` : ""}</li>
          ))}
        </ul>
      ) : null}
      {lastTouched ? <p className="note">Last touched {lastTouched}</p> : null}
      {items.length ? (
        <ol className="tl-list">
          {items.map((item, index) => (
            <li key={`${item.date}-${item.type}-${index}`}>
              <p>
                <strong>{LABELS[item.type] || "Document"}</strong>
                {item.date ? ` · ${item.date}` : ""}
              </p>
              <p>{item.summary}</p>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
