"use client";

import { useEffect, useMemo, useState } from "react";
import SheetGrid from "./SheetGrid";
import NdaDetail from "./NdaDetail";
import {
  counterpartyLine,
  courtDayCount,
  coveredSites,
  dayCount,
  lastActionLine,
  queueCourt,
  type NdaQueueItem,
} from "@/lib/nda";
import { defaultLayout, type ListLayout, type SheetColumn } from "@/lib/listLayout";

type Payload = {
  source?: string;
  as_of?: string;
  label?: string;
  queue?: NdaQueueItem[];
  error?: string;
};

const COLUMN_IDS = ["id", "sites", "party", "status", "court", "daysOpen", "daysCourt", "last", "owner", "next"] as const;

function columns(): SheetColumn<NdaQueueItem>[] {
  return [
    { id: "id", label: "NDA id", text: (row) => row.nda_id },
    { id: "sites", label: "Covered sites", text: (row) => coveredSites(row.site_ids || "").ids.join(", ") || "—" },
    { id: "party", label: "Counterparty", text: (row) => counterpartyLine(row) || "—" },
    { id: "status", label: "Status", text: (row) => row.nda_status || "—" },
    { id: "court", label: "Waiting on", text: (row) => queueCourt(row) },
    { id: "daysOpen", label: "Days open", text: (row) => dayCount(row.nda_days_open) == null ? "—" : String(dayCount(row.nda_days_open)), sortValue: (row) => dayCount(row.nda_days_open) },
    { id: "daysCourt", label: "Days waiting on them", text: (row) => courtDayCount(row.nda_days_in_court) == null ? "—" : String(courtDayCount(row.nda_days_in_court)), sortValue: (row) => courtDayCount(row.nda_days_in_court) },
    { id: "last", label: "Last action", text: (row) => lastActionLine(row) },
    { id: "owner", label: "Owner", text: (row) => row.owner || "—" },
    { id: "next", label: "Next step", text: (row) => row.next_step || "—" },
  ];
}

function filtered(rows: NdaQueueItem[], cols: SheetColumn<NdaQueueItem>[], layout: ListLayout): NdaQueueItem[] {
  const visible = rows.filter((row) => {
    for (const [id, raw] of Object.entries(layout.filters)) {
      const column = cols.find((item) => item.id === id);
      if (!column) continue;
      if (!column.text(row).toLowerCase().includes(raw.trim().toLowerCase())) return false;
    }
    return true;
  });
  const sort = layout.sort;
  if (!sort) return visible;
  const column = cols.find((item) => item.id === sort.id);
  if (!column) return visible;
  return visible.slice().sort((left, right) => {
    const a = column.sortValue?.(left);
    const b = column.sortValue?.(right);
    if (a != null || b != null) {
      if (a == null) return 1;
      if (b == null) return -1;
      if (a !== b) return sort.desc ? b - a : a - b;
    }
    const cmp = column.text(left).localeCompare(column.text(right));
    return sort.desc ? -cmp : cmp;
  });
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function download(cols: SheetColumn<NdaQueueItem>[], rows: NdaQueueItem[]) {
  const header = cols.map((column) => csvCell(column.label)).join(",");
  const body = rows.map((row) => cols.map((column) => csvCell(column.text(row))).join(",")).join("\n");
  const blob = new Blob([`${header}\n${body}\n`], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "nda-queue.csv";
  link.click();
  URL.revokeObjectURL(url);
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
  const [payload, setPayload] = useState<Payload | null>(null);
  const [failed, setFailed] = useState("");
  const [tick, setTick] = useState(0);
  const cols = useMemo(() => columns(), []);
  const [layout, setLayout] = useState<ListLayout>(() => ({
    ...defaultLayout([...COLUMN_IDS], ["id"]),
    sort: { id: "daysCourt", desc: true },
  }));

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
      setPayload(body);
    }).catch(() => {
      if (!cancel) setFailed("The NDA queue could not be loaded.");
    });
    return () => {
      cancel = true;
    };
  }, [tick]);

  const rows = payload?.queue || [];
  const shown = filtered(rows, cols, layout);
  const visibleColumns = cols.filter((column) => !layout.hidden.includes(column.id));
  const open = rows.find((row) => row.nda_id === openId) || null;

  return (
    <aside className="nda-pane" data-testid="nda-queue" aria-label="NDA queue">
      <div className="layers-bar nda-bar">
        <div>
          <p className="eyebrow" id="nda-queue-title">NDA queue</p>
          {payload?.label ? <p className="note">{payload.label}</p> : null}
        </div>
        <button type="button" className="paper-btn" data-testid="nda-export" onClick={() => download(visibleColumns, shown)}>Export CSV</button>
        <button type="button" className="close" aria-label="Close NDA queue" onClick={onClose}><span aria-hidden="true">×</span></button>
      </div>
      <div className="nda-work">
        {failed ? <p className="note">{failed}</p> : null}
        {!failed && payload && rows.length === 0 ? <p className="note">No open NDAs.</p> : null}
        {!payload && !failed ? <p className="note">Loading</p> : null}
        <div className="nda-sheet" data-testid="nda-sheet">
          <div className="list-bar">
            <p>{shown.length.toLocaleString()} shown</p>
          </div>
          <SheetGrid
            rows={shown}
            rowId={(row) => row.nda_id}
            columns={visibleColumns}
            layout={layout}
            onLayout={setLayout}
            selectedId={openId}
            onOpen={onPick}
            onClose={() => onPick("")}
            labelledBy="nda-queue-title"
            renderCell={(row, columnId) => {
              if (columnId === "sites") {
                const ids = coveredSites(row.site_ids || "").ids;
                if (!ids.length) return "—";
                return ids.map((id) => (
                  <button key={id} type="button" className="text-link" onClick={() => onOpen(id)}>{id}</button>
                ));
              }
              const column = cols.find((item) => item.id === columnId);
              return column ? column.text(row) : "";
            }}
          />
        </div>
        <div className="nda-cards" data-testid="nda-cards">
          <label>
            Sort
            <select
              className="secondary"
              aria-label="Sort NDAs"
              value={`${layout.sort?.id || "daysCourt"}:${layout.sort?.desc ? "desc" : "asc"}`}
              onChange={(event) => {
                const [id, dir] = event.target.value.split(":");
                setLayout({ ...layout, sort: { id, desc: dir === "desc" }, touched: true });
              }}
            >
              <option value="daysCourt:desc">Days waiting on them</option>
              <option value="daysOpen:desc">Days open</option>
              <option value="id:asc">NDA id</option>
              <option value="status:asc">Status</option>
            </select>
          </label>
          <ul>
            {shown.map((row) => (
              <li key={row.nda_id}>
                <button type="button" className="list-row nda-card" data-testid={`nda-card-${row.nda_id}`} onClick={() => onPick(row.nda_id)}>
                  <span className="phone-card-name">{row.nda_id}</span>
                  <span>{counterpartyLine(row) || "—"}</span>
                  <span>{row.nda_status || "—"} · {queueCourt(row)}</span>
                  <span>{coveredSites(row.site_ids || "").ids.join(", ") || "No covered site"}</span>
                  <span>{lastActionLine(row)}</span>
                  <span>Owner {row.owner || "—"} · {row.next_step || "No next step"}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        {open ? (
          <NdaDetail
            row={open}
            onClose={() => onPick("")}
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
