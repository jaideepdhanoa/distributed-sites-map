"use client";

import { useState, type ReactNode } from "react";
import { flexRender } from "@tanstack/react-table";
import {
  getCoreRowModel,
  getSortedRowModel,
  useLegacyTable,
  type LegacyColumnDef,
} from "@tanstack/react-table/legacy";
import { shownBroker, shownFirm, shownPriceSource } from "@/lib/format";
import { readCapacity } from "@/lib/keyNumbers";
import { TIER_NOTES, plainVerdict, stageDetail, tierLabel } from "@/lib/labels";
import type { DealProps, SiteProps } from "@/lib/types";

type SortingState = { id: string; desc: boolean }[];

export type ActivitySummary = Record<string, { lastTouched?: string; materials?: number }>;

function touchOf(activity: ActivitySummary, id: string | undefined) {
  if (!id) return undefined;
  return activity[id];
}

const yesNo = (value: unknown) => (value ? "Yes" : "No");

const columns: LegacyColumnDef<SiteProps>[] = [
  { accessorKey: "site_id", header: "Site" },
  { accessorKey: "name", header: "Name" },
  { accessorKey: "city", header: "City" },
  {
    id: "tier",
    accessorFn: (row) => tierLabel(row.land_tier),
    header: "Spare land",
    cell: ({ row }) => {
      const code = row.original.land_tier;
      const label = tierLabel(code);
      const note = code ? TIER_NOTES[code]?.note : "";
      return label ? <span title={note}>{label}</span> : "—";
    },
  },
  { id: "verdict", accessorFn: (row) => plainVerdict(row.verdict), header: "Verdict" },
  { accessorKey: "zoning", header: "Zoning" },
  { accessorKey: "flood_zone", header: "Flood" },
  { accessorKey: "year_built", header: "Year built" },
  { accessorKey: "miles_to_depot", header: "Depot mi" },
  { accessorKey: "spare_ac_own", header: "Own ac" },
  { accessorKey: "spare_ac_adjoining", header: "Adjoining ac" },
  { accessorKey: "tenure", header: "Tenure" },
  { accessorKey: "confidence", header: "Confidence" },
  { accessorKey: "listed", header: "Listed", cell: ({ getValue }) => yesNo(getValue()) },
  { accessorKey: "contacted", header: "Contacted", cell: ({ getValue }) => yesNo(getValue()) },
  { accessorKey: "asking_price_display", header: "Asking" },
  {
    id: "why",
    accessorKey: "summary_why",
    header: "Why",
    cell: ({ getValue }) => {
      const value = String(getValue() || "");
      return value ? <span className="why" title={value}>{value}</span> : "—";
    },
  },
];

function dealForSite(row: SiteProps, deals: DealProps[]) {
  if (row.linked_deal_id) {
    const linked = deals.find((deal) => deal.deal_id === row.linked_deal_id);
    if (linked) return linked;
  }
  return deals.find((deal) => deal.universe_id === row.site_id);
}

export function siteCapacityText(row: SiteProps, deals: DealProps[] = []) {
  return readCapacity({ siteGrade: row.site_capacity, dealGrade: dealForSite(row, deals)?.site_capacity }).grade;
}

export function siteExportHeaders() {
  return ["Site", "Name", "City", "Spare land", "Site capacity", "Verdict", "Zoning", "Flood", "Year built", "Depot mi", "Own ac", "Adjoining ac", "Tenure", "Confidence", "Listed", "Contacted", "Asking", "Why"];
}

export function siteExportRow(row: SiteProps, deals: DealProps[] = []) {
  return [
    row.site_id,
    row.name,
    row.city,
    tierLabel(row.land_tier),
    siteCapacityText(row, deals),
    plainVerdict(row.verdict),
    row.zoning,
    row.flood_zone,
    row.year_built,
    row.miles_to_depot,
    row.spare_ac_own,
    row.spare_ac_adjoining,
    row.tenure,
    row.confidence,
    row.listed ? "Yes" : "No",
    row.contacted ? "Yes" : "No",
    row.asking_price_display,
    row.summary_why,
  ];
}

export default function SiteTable({
  rows,
  deals = [],
  selectedId,
  onSelect,
  sorting,
  onSortingChange,
  activity = {},
}: {
  rows: SiteProps[];
  deals?: DealProps[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  sorting?: SortingState;
  onSortingChange?: (next: SortingState) => void;
  activity?: ActivitySummary;
}) {
  const [localSorting, setLocalSorting] = useState<SortingState>([]);
  const sortingState = sorting ?? localSorting;
  function setSorting(next: SortingState | ((old: SortingState) => SortingState)) {
    const resolved = typeof next === "function" ? next(sortingState) : next;
    if (onSortingChange) onSortingChange(resolved);
    else setLocalSorting(resolved);
  }
  const showWhy = rows.some((row) => row.summary_why);
  const capacityColumn: LegacyColumnDef<SiteProps> = {
    id: "site_capacity",
    header: "Site capacity",
    accessorFn: (row) => siteCapacityText(row, deals),
    cell: ({ row }) => {
      const read = readCapacity({ siteGrade: row.original.site_capacity, dealGrade: dealForSite(row.original, deals)?.site_capacity });
      return <span className={read.grade === "Unknown" ? "unknown-grade" : ""} title={read.basis}>{read.grade}</span>;
    },
  };
  const baseColumns = columns.flatMap((column) => (column.id === "tier" ? [column, capacityColumn] : [column]));
  const activityColumns: LegacyColumnDef<SiteProps>[] = [
    {
      id: "last_touched",
      accessorFn: (row) => touchOf(activity, row.linked_deal_id)?.lastTouched || "",
      header: "Last touched",
    },
    {
      id: "materials",
      accessorFn: (row) => touchOf(activity, row.linked_deal_id)?.materials || 0,
      header: "Materials",
    },
  ];
  const table = useLegacyTable({
    data: rows,
    columns: [...(showWhy ? baseColumns : baseColumns.filter((column) => column.id !== "why")), ...activityColumns],
    state: { sorting: sortingState },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  return (
    <div className="table-wrap">
      <table>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                return (
                  <th key={header.id} aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}>
                    <button type="button" onClick={header.column.getToggleSortingHandler()}>
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {sorted === "asc" ? " ↑" : sorted === "desc" ? " ↓" : ""}
                    </button>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className={row.original.site_id === selectedId ? "on" : ""} onClick={() => onSelect(row.original.site_id)}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext()) as ReactNode}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="stack-list">
        {rows.map((row) => (
          <li key={row.site_id}>
            <button type="button" className={row.site_id === selectedId ? "on" : ""} onClick={() => onSelect(row.site_id)}>
              <strong>{row.name || row.address || row.site_id}</strong>
              <span>{row.site_id} · {plainVerdict(row.verdict)}{row.land_tier ? ` · ${tierLabel(row.land_tier)}` : ""} · Site capacity {siteCapacityText(row, deals)}</span>
              {row.summary_why ? <span className="why">{row.summary_why}</span> : null}
              {touchOf(activity, row.linked_deal_id)?.lastTouched || touchOf(activity, row.linked_deal_id)?.materials ? (
                <span>{touchOf(activity, row.linked_deal_id)?.materials || 0} materials · {touchOf(activity, row.linked_deal_id)?.lastTouched || "—"}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const dealColumns: LegacyColumnDef<DealProps>[] = [
  { accessorKey: "deal_id", header: "Deal" },
  { accessorKey: "name", header: "Name" },
  { accessorKey: "city", header: "City" },
  {
    id: "stage",
    accessorFn: (row) => stageDetail(row.stage, row.stage_group),
    header: "Stage",
  },
  { id: "firm", accessorFn: (row) => shownFirm(row), header: "Firm" },
  { id: "broker", accessorFn: (row) => shownBroker(row), header: "Broker" },
  { accessorKey: "asking_price_display", header: "Asking" },
  { id: "asking_source", accessorFn: (row) => shownPriceSource(row), header: "Asking source" },
  { id: "acres", accessorFn: (row) => row.land_acres, header: "Acres" },
  { id: "per_acre", accessorFn: (row) => row.price_per_acre_display, header: "Per acre" },
  { id: "open_land", accessorFn: (row) => row.open_land_sqft, header: "Open land" },
  {
    id: "site_capacity",
    header: "Site capacity",
    accessorFn: (row) => readCapacity({ dealGrade: row.site_capacity }).grade,
    cell: ({ row }) => {
      const read = readCapacity({ dealGrade: row.original.site_capacity });
      return <span className={read.grade === "Unknown" ? "unknown-grade" : ""} title={read.basis}>{read.grade}</span>;
    },
  },
  {
    id: "cash_flow",
    accessorFn: (row) => row.figures_status === "withheld" ? "Package figures not shown" : (row.stated_cash_flow_display || ""),
    header: "Cash flow",
  },
  { accessorKey: "miles_to_depot", header: "Depot mi" },
  { accessorKey: "checked_live", header: "Checked" },
  { accessorKey: "universe_id", header: "Universe site" },
];

export function DealTable({
  rows,
  selectedId,
  onSelect,
  activity = {},
}: {
  rows: DealProps[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  activity?: ActivitySummary;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const activityColumns: LegacyColumnDef<DealProps>[] = [
    {
      id: "last_touched",
      accessorFn: (row) => touchOf(activity, row.deal_id)?.lastTouched || "",
      header: "Last touched",
    },
    {
      id: "materials",
      accessorFn: (row) => touchOf(activity, row.deal_id)?.materials || 0,
      header: "Materials",
    },
  ];
  const table = useLegacyTable({
    data: rows,
    columns: [...dealColumns, ...activityColumns],
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  return (
    <div className="table-wrap">
      <table>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                return (
                  <th key={header.id} aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}>
                    <button type="button" onClick={header.column.getToggleSortingHandler()}>
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {sorted === "asc" ? " ↑" : sorted === "desc" ? " ↓" : ""}
                    </button>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className={row.original.deal_id === selectedId ? "on" : ""} onClick={() => onSelect(row.original.deal_id)}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext()) as ReactNode}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="stack-list">
        {rows.map((row) => (
          <li key={row.deal_id}>
            <button type="button" className={row.deal_id === selectedId ? "on" : ""} onClick={() => onSelect(row.deal_id)}>
              <strong>{row.name || row.address || row.deal_id}</strong>
              <span>{stageDetail(row.stage, row.stage_group)}{row.asking_price_display ? ` · ${row.asking_price_display}` : ""}</span>
              <span>{row.address}</span>
              {touchOf(activity, row.deal_id)?.lastTouched || touchOf(activity, row.deal_id)?.materials ? (
                <span>{touchOf(activity, row.deal_id)?.materials || 0} materials · {touchOf(activity, row.deal_id)?.lastTouched || "—"}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
