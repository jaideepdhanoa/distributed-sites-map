"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { NdaChip } from "./NdaChip";
import { RowLinks } from "./RowLinks";
import SheetGrid from "./SheetGrid";
import { useListLayout } from "./useListLayout";
import { inMapArea, type MapArea } from "@/lib/geoFilter";
import {
  allowedIds,
  defaultLayout,
  displayIds,
  phoneColumns,
  prepareRows,
  sortFromParam,
  type ListLayout,
  type SheetColumn,
} from "@/lib/listLayout";

export type ListRow = {
  id: string;
  site: string;
  type: string;
  city: string;
  stage: string;
  score: string;
  tier: string;
  spare: string;
  grade: string;
  zoning: string;
  traffic: string;
  listed: string;
  lead: string;
  nda?: string;
  ndaId?: string;
  near?: string;
  nearShort?: string;
  address?: string;
  listingUrl?: string;
  folderUrl?: string;
  packageUrl?: string;
  lng?: number;
  lat?: number;
};

export const LIST_COLUMNS: { id: keyof Omit<ListRow, "id" | "lng" | "lat" | "nda" | "ndaId" | "near" | "nearShort" | "address" | "listingUrl" | "folderUrl" | "packageUrl" | "lead" | "tier" | "zoning" | "city">; label: string }[] = [
  { id: "site", label: "Site" },
  { id: "type", label: "Type" },
  { id: "stage", label: "Stage" },
  { id: "score", label: "Score" },
  { id: "spare", label: "Open land" },
  { id: "grade", label: "Power" },
  { id: "traffic", label: "Traffic" },
  { id: "listed", label: "Asking" },
];

type ListColumnId = (typeof LIST_COLUMNS)[number]["id"];

export function listCsv(rows: ListRow[]) {
  const header = LIST_COLUMNS.map((column) => column.label);
  const lines = [
    header.join(","),
    ...rows.map((row) => LIST_COLUMNS.map((column) => `"${String(row[column.id] ?? "").replace(/"/g, "\"\"")}"`).join(",")),
  ];
  return lines.join("\n");
}

export default function ListView({
  rows,
  selectedId,
  sort,
  onSort,
  onOpen,
  onShowMap,
  onExport,
  note,
  signedIn = false,
  userId = "",
  sortQuery = null,
  mapArea = null,
  onSearchArea,
  onClearArea,
  onDismiss,
}: {
  rows: ListRow[];
  selectedId: string | null;
  sort: { id: string; desc: boolean };
  onSort: (id: ListColumnId | "", desc?: boolean) => void;
  onOpen: (id: string) => void;
  onShowMap: (id: string) => void;
  onExport: () => void;
  note?: string;
  signedIn?: boolean;
  userId?: string;
  sortQuery?: string | null;
  mapArea?: MapArea | null;
  onSearchArea?: () => void;
  onClearArea?: () => void;
  onDismiss?: () => void;
}) {
  const ids = LIST_COLUMNS.map((column) => column.id);
  const allowed = useMemo(() => allowedIds(ids, signedIn), [ids, signedIn]);
  const fallback = useMemo(() => defaultLayout(allowed), [allowed]);
  const { layout, update } = useListLayout({ surface: "universe", signedIn, userId, allowed, seed: null, fallback });
  const [phone, setPhone] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const apply = () => setPhone(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  const sortOverride = sortFromParam(sortQuery === undefined ? `${sort.id}:${sort.desc ? "desc" : "asc"}` : sortQuery, allowed);
  const activeLayout: ListLayout = sortOverride === undefined ? layout : { ...layout, sort: sortOverride };
  const visible = displayIds(activeLayout, allowed, phone, phoneColumns("universe"));
  const columns: SheetColumn<ListRow>[] = visible.map((id) => ({
    id,
    label: LIST_COLUMNS.find((column) => column.id === id)?.label || id,
    text: (row) => shownText(row, id as ListColumnId, signedIn),
  }));
  const ordered = useMemo(() => {
    const scoped = mapArea ? rows.filter((row) => Number.isFinite(row.lng) && Number.isFinite(row.lat) && inMapArea(row.lng as number, row.lat as number, mapArea)) : rows;
    return prepareRows(scoped, columns, activeLayout, visible);
  }, [activeLayout, columns, mapArea, rows, visible]);

  function commit(next: ListLayout) {
    update(next);
    const sortChanged = (next.sort?.id || "") !== (activeLayout.sort?.id || "") || Boolean(next.sort?.desc) !== Boolean(activeLayout.sort?.desc);
    if (sortChanged) onSort((next.sort?.id || "site") as ListColumnId, next.sort ? next.sort.desc : undefined);
  }

  return (
    <div className="list-pane" data-list-count={rows.length}>
      {note ? <p className="list-note" role="status">{note}</p> : null}
      <div className="list-bar">
        <p>{ordered.length.toLocaleString()}{mapArea ? " in this map area" : " shown"}</p>
        {mapArea ? <button type="button" className="chip removable only-desktop" onClick={onClearArea}>Map area</button> : null}
        <label className="list-sort only-mobile">
          Sort
          <select
            className="secondary"
            aria-label="Sort"
            value={activeLayout.sort ? `${activeLayout.sort.id}:${activeLayout.sort.desc ? "desc" : "asc"}` : "none"}
            onChange={(event) => {
              if (event.target.value === "none") {
                commit({ ...activeLayout, sort: null, touched: true });
                return;
              }
              const [id, direction] = event.target.value.split(":");
              commit({ ...activeLayout, sort: { id, desc: direction === "desc" }, touched: true });
            }}
          >
            <option value="none">List order</option>
            {visible.flatMap((id) => {
              const column = LIST_COLUMNS.find((item) => item.id === id);
              if (!column) return [];
              return [
                <option key={`${column.id}:asc`} value={`${column.id}:asc`}>{column.label}, A to Z</option>,
                <option key={`${column.id}:desc`} value={`${column.id}:desc`}>{column.label}, Z to A</option>,
              ];
            })}
          </select>
        </label>
        <button type="button" className="paper-btn only-mobile" data-testid="search-area" onClick={mapArea ? onClearArea : onSearchArea}>{mapArea ? "Clear area" : "Search this area"}</button>
        <button type="button" className="paper-btn" onClick={() => downloadVisible(columns, ordered)}>Export CSV</button>
      </div>
      <SheetGrid
        rows={ordered}
        rowId={(row) => row.id}
        columns={columns}
        layout={activeLayout}
        onLayout={commit}
        selectedId={selectedId}
        onOpen={onOpen}
        onClose={() => onDismiss?.()}
        scrollRef={scrollRef}
        renderCell={(row, column) => column === "site" ? (
          <span className="site-name">
            <span className="site-title">
              <span className="site-name-text">{row.site || "—"}</span>
              {row.address && row.address !== row.site ? <span className="site-address">{row.address}{row.city && !row.address.toLowerCase().includes(row.city.toLowerCase()) ? `, ${row.city}` : ""}</span> : row.city ? <span className="site-address">{row.city}</span> : null}
            </span>
            {row.near ? <span className="badge quiet near-chip" data-testid="near-chip" data-short={row.nearShort || row.near} title="Near means outside the service area, within the miles shown. More than 10 miles is a knock-out.">{row.near}</span> : null}
            <RowLinks listing={row.listingUrl} folder={row.folderUrl} packageHref={row.packageUrl} />
          </span>
        ) : (
          <>
            {shownText(row, column as ListColumnId, signedIn) || "—"}
            {column === "stage" && row.nda ? <NdaChip text={row.nda} deal={{ nda_id: row.ndaId }} /> : null}
          </>
        )}
        trailing={(row) => (
          <button type="button" className="text-link" onClick={(event) => { event.stopPropagation(); onShowMap(row.id); }}>Show on map</button>
        )}
      />
    </div>
  );
}

function downloadVisible(columns: SheetColumn<ListRow>[], rows: ListRow[]) {
  const header = columns.map((column) => column.label);
  const lines = [
    header.join(","),
    ...rows.map((row) => columns.map((column) => `"${column.text(row).replaceAll('"', '""')}"`).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "list.csv";
  link.click();
}

function shownText(row: ListRow, id: ListColumnId, signedIn: boolean) {
  if (id === "listed" && !signedIn) return /^yes/i.test(row.listed) ? "Yes" : row.listed === "No" ? "No" : "—";
  return String(row[id] ?? "");
}
