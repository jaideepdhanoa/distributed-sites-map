"use client";

import { useEffect, useState } from "react";
import { formatActivityWhen } from "@/lib/actions/time";
import {
  counterparty,
  mergeActivity,
  summaryText,
  type ActivityInput,
  type CommsLine,
  type MergedLine,
} from "@/lib/comms";
import { previewAtWord } from "@/lib/displayText";
import { ACTIVITY_TIMEOUT_MS, activityView } from "@/lib/timeline/load";
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
  capture: "Capture",
  bring_back: "Brought back",
  drop_suggested: "Suggested drop",
  drop: "Dropped",
};

const KEPT_LINES = new Set(["bring_back", "drop_suggested", "drop"]);

function WhenStamp({ at, approximate }: { at: string; approximate?: boolean }) {
  const clock = formatActivityWhen(at, approximate);
  if (!clock.label) return null;
  return <time dateTime={clock.title} title={clock.title}>{` · ${clock.label}`}</time>;
}

function ExpandableText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const view = previewAtWord(text);
  if (!view.full) return null;
  if (!view.clipped) return <p>{view.full}</p>;
  return (
    <p>
      {open ? view.full : view.preview}{" "}
      <button type="button" className="text-link" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {open ? "Show less" : "Show more"}
      </button>
    </p>
  );
}

function activityLine(item: MergedLine, index: number) {
  return (
    <li key={`${item.eventId}-${item.at}-${item.type}-${index}`}>
      <p>
        <strong>{LABELS[item.type] || "Document"}</strong>
        <WhenStamp at={item.at} approximate={item.approximate} />
      </p>
      <ExpandableText text={item.summary} />
    </li>
  );
}

function commsLine(item: MergedLine, index: number) {
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
        <WhenStamp at={item.at} approximate={item.approximate} />
        {item.channel ? ` · ${item.channel}` : ""}
      </p>
      {party ? <p>{party}</p> : null}
      <ExpandableText text={summaryText(item.summary)} />
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

async function loadPart<T>(url: string, signal: AbortSignal, accept: (body: T) => boolean): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("activity");
  const body = (await response.json()) as T;
  if (!accept(body)) throw new Error("activity");
  return body;
}

export default function Timeline({ recordId, relatedId }: { recordId: string; relatedId?: string }) {
  const [timeline, setTimeline] = useState<TimelinePayload | null>(null);
  const [comms, setComms] = useState<CommsPayload | null>(null);
  const [showInternal, setShowInternal] = useState(false);
  const [pending, setPending] = useState(true);
  const [timelineError, setTimelineError] = useState(false);
  const [commsError, setCommsError] = useState(false);

  useEffect(() => {
    let cancel = false;
    setTimeline(null);
    setComms(null);
    setShowInternal(false);
    setPending(true);
    setTimelineError(false);
    setCommsError(false);
    const query = new URLSearchParams({ id: recordId });
    if (relatedId) query.set("related", relatedId);
    async function load() {
      if (!cancel) setPending(true);
      const timelineAbort = new AbortController();
      const commsAbort = new AbortController();
      const timer = window.setTimeout(() => {
        timelineAbort.abort();
        commsAbort.abort();
      }, ACTIVITY_TIMEOUT_MS);
      try {
        const [timelineResult, commsResult] = await Promise.allSettled([
          loadPart<TimelinePayload>(`/api/data/timeline?${query}`, timelineAbort.signal, () => true),
          loadPart<CommsPayload>(`/api/data/comms?${query}`, commsAbort.signal, (body) => Array.isArray(body?.rows)),
        ]);
        if (cancel) return;
        const view = activityView({
          timeline: timelineResult.status === "fulfilled" ? { ok: true, value: timelineResult.value } : { ok: false },
          comms: commsResult.status === "fulfilled" ? { ok: true, value: commsResult.value } : { ok: false },
        });
        setTimeline(view.timeline);
        setComms(view.comms);
        setTimelineError(view.timelineError);
        setCommsError(view.commsError);
      } finally {
        if (!cancel) setPending(false);
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
  const empty = !pending && !timelineError && !commsError && !folderUrl && materials.length === 0 && !lastTouched && merged.length === 0;

  return (
    <section className="tl" data-testid="activity">
      <h3>Activity</h3>
      {pending ? <p className="note">Loading activity.</p> : null}
      {timelineError ? <p className="note" role="alert" data-testid="activity-timeline-error">Activity could not be loaded. Try this site again.</p> : null}
      {commsError ? <p className="note" role="alert" data-testid="activity-comms-error">Comms could not be loaded. Try this site again.</p> : null}
      {empty ? <p className="note" data-testid="activity-gap">No activity or comms are on file for this site.</p> : null}
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
