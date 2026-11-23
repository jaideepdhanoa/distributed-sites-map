"use client";

import { useEffect, useMemo, useState } from "react";
import NdaDetail from "./NdaDetail";
import { counterpartyLine, coveredSites, stageLabel, type NdaQueueItem } from "@/lib/nda";

type Payload = {
  queue?: NdaQueueItem[];
  error?: string;
};

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

function coveredLabel(row: NdaQueueItem): string {
  const covered = coveredSites(row.site_ids || "");
  const refs = row.covered_refs || [];
  if (covered.ids.length) return covered.ids.join(", ");
  return covered.note || refs.find((item) => !/^(?:PIPE|LAND|L)-/.test(item)) || row.scope || "No covered listing";
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
  backLabel,
}: {
  openId: string;
  onOpen: (id: string) => void;
  onPick: (id: string) => void;
  onClose: () => void;
  onBack: () => void;
  backLabel: string;
}) {
  const [rows, setRows] = useState<NdaQueueItem[]>([]);
  const [failed, setFailed] = useState("");
  const [tick, setTick] = useState(0);
  const [tab, setTab] = useState<Tab>("all");
  const [menu, setMenu] = useState(false);
  const today = todayIso();

  useEffect(() => {
    let cancel = false;
    fetch("/api/data/nda").then(async (response) => {
      const body = (await response.json().catch(() => ({}))) as Payload;
      if (cancel) return;
      if (!response.ok) {
        setFailed(body.error || "The NDA queue could not be loaded.");
        return;
      }
      setFailed("");
      setRows(body.queue || []);
    }).catch(() => {
      if (!cancel) setFailed("The NDA queue could not be loaded.");
    });
    return () => {
      cancel = true;
    };
  }, [tick]);

  const shown = useMemo(() => rows.filter((row) => inTab(row, tab)).slice().sort((left, right) => {
    const a = left.days_court;
    const b = right.days_court;
    if (a == null && b == null) return left.nda_id.localeCompare(right.nda_id);
    if (a == null) return 1;
    if (b == null) return -1;
    if (a !== b) return b - a;
    return left.nda_id.localeCompare(right.nda_id);
  }), [rows, tab]);
  const open = rows.find((row) => row.nda_id === openId) || null;

  function download() {
    const header = ["NDA", "Firm", "Listings", "Stage", "Court", "Owner", "Next step", "Due"].map(csvCell).join(",");
    const body = shown.map((row) => [
      row.nda_id,
      counterpartyLine(row),
      coveredLabel(row),
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
        <p className="eyebrow" id="nda-queue-title">{rows.length.toLocaleString()} open</p>
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
          <button key={item.id} type="button" role="tab" className={tab === item.id ? "chip on" : "chip"} aria-selected={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</button>
        ))}
      </div>
      <div className="nda-work">
        {failed ? <p className="note">{failed}</p> : null}
        {!failed && rows.length === 0 ? <p className="note">No open NDAs.</p> : null}
        <ul className="nda-list" data-testid="nda-cards">
          {shown.map((row) => {
            const overdue = Boolean(row.next_step_due && row.next_step_due < today);
            return (
              <li key={row.nda_id}>
                <button type="button" className="list-row nda-row" data-testid={`nda-card-${row.nda_id}`} onClick={() => onPick(row.nda_id)}>
                  <strong>{counterpartyLine(row) || row.nda_id}</strong>
                  <span>{coveredLabel(row)}</span>
                  <span>{stageLabel(row.stage) || row.nda_status || "—"}</span>
                  {row.court_pill ? <span className="chip">{row.court_pill}</span> : null}
                  <span>{row.owner || "Unassigned"}</span>
                  <span className={overdue ? "nda-overdue" : ""}>{row.next_step || "No next step"}{row.next_step_due ? ` · ${row.next_step_due}` : ""}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {open ? (
          <NdaDetail
            row={open}
            today={today}
            onOpenSite={onOpen}
            onSaved={() => setTick((value) => value + 1)}
            onBack={onBack}
            backLabel={backLabel}
          />
        ) : null}
      </div>
    </aside>
  );
}
