"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatActivityWhen } from "@/lib/actions/time";
import { currentSearch, rememberSearch } from "@/lib/navSearch";
import {
  counterparty,
  mergeActivity,
  summaryText,
  type ActivityInput,
  type CommsLine,
  type MergedLine,
} from "@/lib/comms";
import NoteBody from "../NoteBody";
import { MentionChips, type MentionAccount } from "../actions/MentionField";
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
  stage_repair: "Stage",
};

const KEPT_LINES = new Set(["bring_back", "drop_suggested", "drop", "stage_repair"]);

function EntryTitle({ at, approximate, title }: { at: string; approximate?: boolean; title: string }) {
  const clock = formatActivityWhen(at, approximate);
  const when = clock.label || (approximate ? "Date approximate" : "Date not recorded");
  return (
    <p className="tl-title">
      <time dateTime={clock.title || undefined} title={clock.title || when}>{when}</time>
      <span title={title}>{title}</span>
    </p>
  );
}

function activityLine(item: MergedLine, index: number) {
  return (
    <li key={`${item.eventId}-${item.at}-${item.type}-${index}`} data-testid="timeline-entry">
      <EntryTitle at={item.at} approximate={item.approximate} title={LABELS[item.type] || "Note"} />
      <NoteBody text={item.summary} />
    </li>
  );
}

function commsLine(item: MergedLine, index: number, msg: string, onOpen: (id: string) => void) {
  const party = counterparty(item);
  const internal = item.direction.trim().toLowerCase() === "internal";
  return (
    <li
      key={`${item.commsId}-${index}`}
      className={[internal ? "tl-internal" : "", msg && item.commsId === msg ? "tl-highlight" : ""].filter(Boolean).join(" ") || undefined}
      ref={msg && item.commsId === msg ? (node) => node?.scrollIntoView({ block: "center" }) : undefined}
      data-testid={item.commsId ? `comms-${item.commsId}` : undefined}
      data-direction={item.direction}
    >
      <button type="button" className="list-row" onClick={() => item.commsId && onOpen(item.commsId)}>
        <EntryTitle
          at={item.at}
          approximate={item.approximate}
          title={[item.direction, item.channel, party].map((part) => part.trim()).filter(Boolean).join(" · ") || "Note"}
        />
      </button>
      <NoteBody text={summaryText(item.summary)} />
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

type NdaNote = {
  id: string;
  parentId?: string | null;
  body: string;
  authorId: string;
  createdAt: string;
  deleted?: boolean;
  mentions?: MentionAccount[];
  anchor?: { type?: string; line?: string };
};

export default function Timeline({ recordId, relatedId, ndaId = "", onOpenNda }: { recordId: string; relatedId?: string; ndaId?: string; onOpenNda?: (id: string) => void }) {
  const [timeline, setTimeline] = useState<TimelinePayload | null>(null);
  const [comms, setComms] = useState<CommsPayload | null>(null);
  const [showInternal, setShowInternal] = useState(false);
  const [pending, setPending] = useState(true);
  const [timelineError, setTimelineError] = useState(false);
  const params = useSearchParams();
  const router = useRouter();
  const msg = params.get("msg") || "";
  function openMessage(id: string) {
    const next = new URLSearchParams(currentSearch().replace(/^\?/, ""));
    next.delete("q");
    next.set("panel", "activity");
    next.set("msg", id);
    const href = `/?${next.toString()}`;
    rememberSearch(href);
    router.replace(href, { scroll: false });
  }
  const [commsError, setCommsError] = useState(false);
  const [ndaNotes, setNdaNotes] = useState<NdaNote[]>([]);
  const [ndaNames, setNdaNames] = useState<Record<string, string>>({});

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

  useEffect(() => {
    if (!/^NDA-\d{3,}$/i.test(ndaId)) {
      setNdaNotes([]);
      return undefined;
    }
    let cancel = false;
    const query = new URLSearchParams({ targetKind: "nda", targetId: ndaId });
    fetch(`/api/actions/notes?${query}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { notes: [] }))
      .then((body: { notes?: NdaNote[] }) => {
        if (!cancel) setNdaNotes(body.notes || []);
      })
      .catch(() => undefined);
    fetch("/api/actions/accounts", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { accounts: [] }))
      .then((body: { accounts?: { id: string; name: string }[] }) => {
        if (cancel) return;
        const names: Record<string, string> = {};
        for (const account of body.accounts || []) names[account.id] = account.name;
        setNdaNames(names);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [ndaId]);

  const materials = timeline?.materials || [];
  const activity = (timeline?.items || []).filter((item) => KEPT_LINES.has(item.type) || timeline?.showActivityLines !== false);
  const commsRows = comms?.rows || [];
  const internalRows = comms?.internal || [];
  const merged = mergeActivity(activity, showInternal ? [...commsRows, ...internalRows] : commsRows, {
    includeInternal: showInternal,
  });
  const folderUrl = timeline?.folderUrl || "";
  const lastTouched = timeline?.lastTouched || "";
  const empty = !pending && !timelineError && !commsError && !folderUrl && materials.length === 0 && !lastTouched && merged.length === 0 && ndaNotes.length === 0;

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
      {merged.length || ndaNotes.length ? (
        <ol className="tl-list">
          {ndaNotes.filter((note) => !note.parentId && !note.deleted && note.anchor?.type === "nda").map((note) => (
            <li key={note.id} data-testid="timeline-entry" data-nda-comment={ndaId}>
              <p className="tl-title">
                <time dateTime={note.createdAt}>{formatActivityWhen(note.createdAt).label}</time>
                <span>{ndaNames[note.authorId] || note.authorId}</span>
              </p>
              <NoteBody text={note.body} />
              {note.mentions?.length ? <p className="note">Mentioned <MentionChips mentions={note.mentions} /></p> : null}
              <button type="button" className="chip" data-testid="nda-activity-chip" onClick={() => onOpenNda?.(note.anchor?.line || ndaId)}>on {note.anchor?.line || ndaId}</button>
            </li>
          ))}
          {merged.map((item, index) => (item.kind === "comms" ? commsLine(item, index, msg, openMessage) : activityLine(item, index)))}
        </ol>
      ) : null}
    </section>
  );
}
