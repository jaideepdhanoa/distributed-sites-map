"use client";

import { useEffect, useState } from "react";
import {
  counterparty,
  mergeActivity,
  summaryText,
  whenParts,
  type ActivityInput,
  type CommsLine,
  type MergedLine,
} from "@/lib/comms";
import "./timeline.css";

type Material = { category: string; label: string; count: number; latest: string };
type TimelinePayload = {
  folderUrl?: string;
  materials?: Material[];
  lastTouched?: string;
  items?: ActivityInput[];
  showActivityLines?: boolean;
};
type CommsPayload = {
  rows?: CommsLine[];
  internal?: CommsLine[];
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

function activityLine(item: MergedLine, index: number) {
  return (
    <li key={`${item.eventId}-${item.at}-${item.type}-${index}`}>
      <p>
        <strong>{LABELS[item.type] || "Document"}</strong>
        {item.at ? ` · ${item.at}` : ""}
      </p>
      <p>{item.summary}</p>
    </li>
  );
}

function commsLine(item: MergedLine, index: number) {
  const when = whenParts(item.at);
  const party = counterparty(item);
  const internal = item.direction.trim().toLowerCase() === "internal";
  return (
    <li
      key={`${item.commsId}-${index}`}
      className={internal ? "tl-internal" : undefined}
      data-testid={`comms-${item.commsId}`}
      data-direction={item.direction}
    >
      <p>
        <strong>{item.direction}</strong>
        {when.date ? ` · ${when.date}` : ""}
        {when.time ? ` ${when.time} PT` : ""}
        {item.channel ? ` · ${item.channel}` : ""}
      </p>
      {party ? <p>{party}</p> : null}
      <p>{summaryText(item.summary)}</p>
      {item.href ? (
        <p>
          <a className="text-link" href={item.href} target="_blank" rel="noopener noreferrer">
            Open in Gmail ↗
          </a>
        </p>
      ) : null}
    </li>
  );
}

export default function Timeline({ recordId, relatedId }: { recordId: string; relatedId?: string }) {
  const [timeline, setTimeline] = useState<TimelinePayload | null>(null);
  const [comms, setComms] = useState<CommsPayload | null>(null);
  const [showInternal, setShowInternal] = useState(false);

  useEffect(() => {
    let cancel = false;
    setTimeline(null);
    setComms(null);
    setShowInternal(false);
    const query = new URLSearchParams({ id: recordId });
    if (relatedId) query.set("related", relatedId);
    async function load() {
      try {
        const [timelineResponse, commsResponse] = await Promise.all([
          fetch(`/api/data/timeline?${query}`),
          fetch(`/api/data/comms?${query}`),
        ]);
        const nextTimeline = timelineResponse.ok ? ((await timelineResponse.json()) as TimelinePayload) : {};
        const nextComms = commsResponse.ok ? ((await commsResponse.json()) as CommsPayload) : null;
        if (cancel) return;
        setTimeline(nextTimeline);
        setComms(nextComms && Array.isArray(nextComms.rows) ? nextComms : null);
      } catch {
        if (!cancel) {
          setTimeline({});
          setComms(null);
        }
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

  const materials = timeline?.materials || [];
  const activity = (timeline?.items || []).filter((item) => KEPT_LINES.has(item.type) || timeline?.showActivityLines !== false);
  const commsRows = comms?.rows || [];
  const internalRows = comms?.internal || [];
  const merged = mergeActivity(activity, showInternal ? [...commsRows, ...internalRows] : commsRows, {
    includeInternal: showInternal,
  });
  const folderUrl = timeline?.folderUrl || "";
  const lastTouched = timeline?.lastTouched || "";
  const empty = timeline !== null && !folderUrl && materials.length === 0 && !lastTouched && merged.length === 0;

  return (
    <section className="tl" data-testid="activity">
      <h3>Activity</h3>
      {timeline === null ? <p className="note">Loading activity.</p> : null}
      {empty ? <p className="note">No materials on file.</p> : null}
      {internalRows.length ? (
        <label className="tl-toggle">
          <input
            className="check"
            type="checkbox"
            checked={showInternal}
            data-testid="show-internal"
            onChange={(event) => setShowInternal(event.target.checked)}
          />
          Show internal
        </label>
      ) : null}
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
      {merged.length ? (
        <ol className="tl-list">
          {merged.map((item, index) => (item.kind === "comms" ? commsLine(item, index) : activityLine(item, index)))}
        </ol>
      ) : null}
    </section>
  );
}
