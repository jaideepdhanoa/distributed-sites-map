"use client";

import { useEffect, useState } from "react";
import {
  counterparty,
  mergeActivity,
  summaryText,
  type ActivityInput,
  commsWhenText,
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
        {item.approximate ? " (approximate)" : ""}
      </p>
      <p>{item.summary}</p>
    </li>
  );
}

function commsLine(item: MergedLine, index: number) {
  const when = commsWhenText(item.at, item.approximate);
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
        {when ? ` · ${when}` : ""}
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

const ACTIVITY_TIMEOUT_MS = 8000;

export default function Timeline({ recordId, relatedId }: { recordId: string; relatedId?: string }) {
  const [timeline, setTimeline] = useState<TimelinePayload | null>(null);
  const [comms, setComms] = useState<CommsPayload | null>(null);
  const [showInternal, setShowInternal] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancel = false;
    setTimeline(null);
    setComms(null);
    setShowInternal(false);
    setFailed(false);
    const query = new URLSearchParams({ id: recordId });
    if (relatedId) query.set("related", relatedId);
    async function load() {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), ACTIVITY_TIMEOUT_MS);
      try {
        const [timelineResponse, commsResponse] = await Promise.all([
          fetch(`/api/data/timeline?${query}`, { signal: controller.signal }),
          fetch(`/api/data/comms?${query}`, { signal: controller.signal }),
        ]);
        if (!timelineResponse.ok || !commsResponse.ok) throw new Error("activity");
        const nextTimeline = (await timelineResponse.json()) as TimelinePayload;
        const nextComms = (await commsResponse.json()) as CommsPayload;
        if (cancel) return;
        setFailed(false);
        setTimeline(nextTimeline);
        setComms(nextComms && Array.isArray(nextComms.rows) ? nextComms : null);
      } catch {
        if (!cancel) {
          setFailed(true);
          setTimeline({});
          setComms(null);
        }
      } finally {
        window.clearTimeout(timer);
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
      {failed ? <p className="note" role="alert" data-testid="activity-error">Activity could not be loaded. Try this site again.</p> : null}
      {empty && !failed ? <p className="note">No activity on file yet.</p> : null}
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
