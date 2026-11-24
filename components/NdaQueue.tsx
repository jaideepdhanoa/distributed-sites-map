"use client";

import { useEffect, useState } from "react";
import NdaDetail from "./NdaDetail";
import { isOpenAgreement, collapseContained, counterpartyLine, coveredSites, stageLabel, type NdaQueueItem } from "@/lib/nda";

type Payload = {
  queue?: NdaQueueItem[];
  error?: string;
};

let remembered: NdaQueueItem[] = [];

type Tab = "us" | "them" | "all";

const TABS: { id: Tab; label: string }[] = [
  { id: "us", label: "Our court" },
  { id: "them", label: "Their court" },
  { id: "all", label: "All" },
];

function todayIso(): string {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
}

function coveredLabel(row: NdaQueueItem, names: Record<string, string>): string {
  const covered = coveredSites(row.site_ids || "");
  if (covered.ids.length > 2) return `${covered.ids.length} sites`;
  if (covered.ids.length) return collapseContained(covered.ids.map((id) => names[id] || "Covered site")).join(" · ");
  const refs = row.covered_refs || [];
  return covered.note || refs.find((item) => !/^(?:PIPE|LAND|L)-/.test(item)) || row.scope || "No covered listing";
}

function queueLine(row: NdaQueueItem, names: Record<string, string>): string {
  const contact = row.counterparty_person || row.contact_name || "No contact";
  const stage = stageLabel(row.stage) || row.nda_status || "—";
  const scope = coveredLabel(row, names);
  const distinct = scope && scope !== "No covered listing" ? scope : "";
  return collapseContained([contact, stage, distinct]).join(" · ");
}

function CourtPill({ court, label }: { court: string; label: string }) {
  if (!label) return null;
  const aged = /(?:^|\s)(\d+)d/.exec(label);
  const strong = court === "us" && aged && Number(aged[1]) >= 14;
  return <span className={`court-pill ${court === "us" ? "us" : "them"}${strong ? " aged" : ""}`}>{label}</span>;
}

function inTab(row: NdaQueueItem, tab: Tab): boolean {
  if (tab === "all") return true;
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
  const [owner, setOwner] = useState("");
  const [status, setStatus] = useState("all");
  const [order, setOrder] = useState("due");
  const [menu, setMenu] = useState(false);
  const [picked, setPicked] = useState(openId);
  const today = todayIso();

  useEffect(() => {
    let cancel = false;
    fetch("/api/data/nda", { cache: "no-store" }).then(async (response) => {
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

  const closed = (row: NdaQueueItem) => !isOpenAgreement(row) || ["declined", "executed", "expired", "not_required"].includes(row.stage);
  function priority(row: NdaQueueItem) {
    if (closed(row)) return "Closed";
    if (!row.next_step_due) return "No due date";
    if (row.next_step_due < today) return "Overdue";
    return row.next_step_due === today ? "Due today" : "Upcoming";
  }
  const population = rows.filter(row =>
    (!owner || (owner === "unassigned" ? !row.owner : row.owner === owner))
    && (status === "all" || (status === "closed" ? closed(row) : !closed(row)))
    && (order !== "missing" || !row.next_step));
  const counts = { us: population.filter(row => inTab(row, "us")).length,
    them: population.filter(row => inTab(row, "them")).length, all: population.length };
  const owners = Array.from(new Map(rows.filter(row => row.owner).map(row => [row.owner, row.owner_name || row.owner])).entries());
  const shown = population.filter(row => inTab(row, tab)).sort((left, right) => {
    if (order === "due") {
      if (closed(left) !== closed(right)) return Number(closed(left)) - Number(closed(right));
      const byDate = (left.next_step_due || "9999").localeCompare(right.next_step_due || "9999");
      if (byDate) return byDate;
    }
    const a = left.days_court;
    const b = right.days_court;
    if (a == null && b == null) return left.nda_id.localeCompare(right.nda_id);
    if (a == null) return 1;
    if (b == null) return -1;
    if (a !== b) return b - a;
    return left.nda_id.localeCompare(right.nda_id);
  });
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
      <div className="nda-filters">
        <label>Owner<select className="secondary" value={owner} onChange={e => setOwner(e.target.value)}>
          <option value="">All owners</option><option value="unassigned">Unassigned</option>{owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select></label>
        <label>Status<select className="secondary" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="all">All records</option><option value="active">Active</option><option value="closed">Closed</option>
        </select></label>
        <label>Priority<select className="secondary" value={order} onChange={e => setOrder(e.target.value)}>
          <option value="due">Next due first</option><option value="wait">Longest wait</option><option value="missing">Missing next step</option>
        </select></label>
      </div>
      <div className="nda-work">
        {failed ? <p className="note">{failed}</p> : null}
        {!loaded && !failed ? (
          <ul className="nda-list" data-testid="nda-loading" aria-busy="true" aria-label="Loading NDAs">
            {[0, 1, 2, 3].map((item) => <li key={item} className="nda-row nda-hold"><span className="skeleton nda-skel" /><span className="skeleton nda-skel wide" /></li>)}
          </ul>
        ) : null}
        {loaded && !failed && !shown.length && <div className="note">{!rows.length ? "No agreements on file." : owner === "unassigned" && !rows.some(row => !row.owner) ? "Every agreement has an owner." : "No agreements match these filters."}
          {rows.length > 0 && <button className="text-link" type="button" onClick={() => { setOwner(""); setTab("all"); setOrder("due"); setStatus("all"); }}>Clear NDA filters</button>}
        </div>}
        {picked && loaded && !open ? <p className="note">That NDA is not in the open list.</p> : null}
        <ul className="nda-list" data-testid="nda-cards">
          {shown.map((row, index) => {
            const overdue = !closed(row) && Boolean(row.next_step_due && row.next_step_due < today);
            const next = row.next_step || "No next step";
            return (
              <li key={row.nda_id}>
                {order === "due" && (!index || priority(row) !== priority(shown[index - 1])) && <h3 className="nda-priority">{priority(row)}</h3>}
                <button type="button" className="list-row nda-row" data-testid={`nda-card-${row.nda_id}`} onClick={() => pick(row.nda_id)}>
                  <span className="nda-line">
                    <strong>{row.counterparty_firm || row.nda_id}</strong>
                    <CourtPill court={row.court} label={row.court_pill} />
                  </span>
                  <span>{queueLine(row, names)}</span>
                  <span className={overdue ? "nda-overdue" : "note"}>{`${row.owner_name || row.owner || "Unassigned"} · ${next}${row.next_step_due ? ` · ${overdue ? "Overdue" : "Due"} ${row.next_step_due}` : ""}`}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {open ? (
          <NdaDetail
            key={`${open.nda_id}:${open.version}:${open.contact_email || ""}:${open.contact_phone || ""}`}
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
