"use client";

import { useEffect, useMemo, useState } from "react";
import NdaDetail from "./NdaDetail";
import { counterpartyLine, coveredSites, stageLabel, type NdaQueueItem } from "@/lib/nda";

type Payload = {
  queue?: NdaQueueItem[];
  error?: string;
};

let remembered: NdaQueueItem[] = [];

type Tab = "us" | "them" | "open" | "all";

const TABS: { id: Tab; label: string }[] = [
  { id: "us", label: "Our court" },
  { id: "them", label: "Their court" },
  { id: "open", label: "Unassigned" },
  { id: "all", label: "All" },
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function coveredLabel(row: NdaQueueItem, names: Record<string, string>): string {
  const covered = coveredSites(row.site_ids || "");
  if (covered.ids.length > 2) return `${covered.ids.length} sites`;
  if (covered.ids.length) return [...new Set(covered.ids.map((id) => names[id] || "Covered site"))].join(" · ");
  const refs = row.covered_refs || [];
  return covered.note || refs.find((item) => !/^(?:PIPE|LAND|L)-/.test(item)) || row.scope || "No covered listing";
}

function queueLine(row: NdaQueueItem, names: Record<string, string>): string {
  const contact = row.counterparty_person || row.contact_name || "No contact";
  const stage = stageLabel(row.stage) || row.nda_status || "—";
  const scope = coveredLabel(row, names);
  const next = row.next_step || "";
  const distinct = scope && scope !== contact && scope !== stage && scope !== next && scope !== "No covered listing";
  return [contact, stage, distinct ? scope : ""].filter(Boolean).join(" · ");
}

function CourtPill({ court, label }: { court: string; label: string }) {
  if (!label) return null;
  const aged = /(?:^|\s)(\d+)d/.exec(label);
  const strong = court === "us" && aged && Number(aged[1]) >= 14;
  return <span className={`court-pill ${court === "us" ? "us" : "them"}${strong ? " aged" : ""}`}>{label}</span>;
}

function inTab(row: NdaQueueItem, tab: Tab): boolean {
  if (tab === "all") return true;
  if (tab === "open") return !row.owner;
  if (tab === "us") return row.court === "us";
  return row.court === "them" || row.court === "seller";
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export default function NdaQueue({
  openId,
  onOpen,
  onPick,
  onClose,
  onBack,
  onMenu,
  backLabel,
  names = {},
}: {
  openId: string;
  onOpen: (id: string) => void;
  onPick: (id: string) => void;
  onClose: () => void;
  onBack: () => void;
  onMenu: () => void;
  backLabel: string;
  names?: Record<string, string>;
}) {
  const [rows, setRows] = useState<NdaQueueItem[]>(remembered);
  const [loaded, setLoaded] = useState(remembered.length > 0);
  const [failed, setFailed] = useState("");
  const [tick, setTick] = useState(0);
  const [tab, setTab] = useState<Tab>("all");
  const [menu, setMenu] = useState(false);
  const [picked, setPicked] = useState(openId);
  const today = todayIso();

  useEffect(() => {
    let cancel = false;
    fetch("/api/data/nda").then(async (response) => {
      const body = (await response.json().catch(() => ({}))) as Payload;
      if (cancel) return;
      if (!response.ok) {
        setFailed(body.error || "The NDA queue could not be loaded.");
        setLoaded(true);
        return;
      }
      setFailed("");
      remembered = body.queue || [];
      setRows(remembered);
      setLoaded(true);
    }).catch(() => {
      if (!cancel) {
        setFailed("The NDA queue could not be loaded.");
        setLoaded(true);
      }
    });
    return () => {
      cancel = true;
    };
  }, [tick]);

  useEffect(() => {
    setPicked(openId);
    setMenu(false);
  }, [openId]);

  useEffect(() => {
    if (!menu) return undefined;
    function close(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest(".more-wrap")) return;
      setMenu(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  function pick(id: string) {
    setMenu(false);
    setPicked(id);
    onPick(id);
  }

  const counts = useMemo(() => ({
    us: rows.filter((row) => inTab(row, "us")).length,
    them: rows.filter((row) => inTab(row, "them")).length,
    open: rows.filter((row) => inTab(row, "open")).length,
    all: rows.length,
  }), [rows]);
  const shown = useMemo(() => rows.filter((row) => inTab(row, tab)).slice().sort((left, right) => {
    const a = left.days_court;
    const b = right.days_court;
    if (a == null && b == null) return left.nda_id.localeCompare(right.nda_id);
    if (a == null) return 1;
    if (b == null) return -1;
    if (a !== b) return b - a;
    return left.nda_id.localeCompare(right.nda_id);
  }), [rows, tab]);
  const open = rows.find((row) => row.nda_id === (picked || openId)) || null;

  function download() {
    const header = ["NDA", "Firm", "Listings", "Stage", "Court", "Owner", "Next step", "Due"].map(csvCell).join(",");
    const body = shown.map((row) => [
      row.nda_id,
      counterpartyLine(row),
      coveredLabel(row, names),
      stageLabel(row.stage) || row.nda_status,
      row.court_pill,
      row.owner,
      row.next_step,
      row.next_step_due,
    ].map((value) => csvCell(value || "")).join(",")).join("\n");
    const blob = new Blob([`${header}\n${body}\n`], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "nda-queue.csv";
    link.click();
    URL.revokeObjectURL(url);
    setMenu(false);
  }

  return (
    <aside className="nda-pane" data-testid="nda-queue" aria-label="NDA queue">
      <div className="layers-bar nda-bar">
        <p className="eyebrow" id="nda-queue-title">NDAs</p>
        <div className="more-wrap">
          <button type="button" className="paper-btn" aria-label="NDA actions" aria-expanded={menu} onClick={() => setMenu((value) => !value)}>⋯</button>
          {menu ? (
            <div className="menu" role="menu">
              <button type="button" className="menu-item" data-testid="nda-export" onClick={download}>Export CSV</button>
            </div>
          ) : null}
        </div>
        <button type="button" className="close" aria-label="Close NDA queue" onClick={onClose}><span aria-hidden="true">×</span></button>
      </div>
      <div className="nda-tabs" role="tablist" aria-label="Whose court">
        {TABS.map((item) => (
          <button key={item.id} type="button" role="tab" className={tab === item.id ? "chip on" : "chip"} aria-selected={tab === item.id} onClick={() => setTab(item.id)}>{item.label} {loaded ? counts[item.id] : ""}</button>
        ))}
      </div>
      <div className="nda-work">
        {failed ? <p className="note">{failed}</p> : null}
        {!loaded && !failed ? (
          <ul className="nda-list" data-testid="nda-loading" aria-busy="true" aria-label="Loading NDAs">
            {[0, 1, 2, 3].map((item) => <li key={item} className="nda-row nda-hold"><span className="skeleton nda-skel" /><span className="skeleton nda-skel wide" /></li>)}
          </ul>
        ) : null}
        {loaded && !failed && rows.length === 0 ? <p className="note">No open NDAs.</p> : null}
        {picked && loaded && !open ? <p className="note">That NDA is not in the open list.</p> : null}
        <ul className="nda-list" data-testid="nda-cards">
          {shown.map((row) => {
            const overdue = Boolean(row.next_step_due && row.next_step_due < today);
            const next = row.next_step || "No next step";
            return (
              <li key={row.nda_id}>
                <button type="button" className="list-row nda-row" data-testid={`nda-card-${row.nda_id}`} onClick={() => pick(row.nda_id)}>
                  <span className="nda-line">
                    <strong>{row.counterparty_firm || row.nda_id}</strong>
                    <CourtPill court={row.court} label={row.court_pill} />
                  </span>
                  <span>{queueLine(row, names)}</span>
                  <span className={overdue ? "nda-overdue" : "note"}>{`${row.owner_name || row.owner || "Unassigned"} · ${next}${row.next_step_due ? ` · ${row.next_step_due}` : ""}`}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {open ? (
          <NdaDetail
            key={open.nda_id}
            row={open}
            today={today}
            names={names}
            onOpenSite={(id) => { setMenu(false); onOpen(id); }}
            onSaved={() => setTick((value) => value + 1)}
            onBack={onBack}
            onClose={onClose}
            onMenu={onMenu}
            backLabel={backLabel}
          />
        ) : null}
      </div>
    </aside>
  );
}
