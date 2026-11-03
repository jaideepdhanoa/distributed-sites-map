"use client";

import { useState, type ReactNode } from "react";
import { flexRender } from "@tanstack/react-table";
import {
  getCoreRowModel,
  getSortedRowModel,
  useLegacyTable,
  type LegacyColumnDef,
} from "@tanstack/react-table/legacy";
import type { DealProps, SiteProps } from "@/lib/types";

type SortingState = { id: string; desc: boolean }[];

const yesNo = (value: unknown) => (value ? "Yes" : "No");

const columns: LegacyColumnDef<SiteProps>[] = [
  { accessorKey: "site_id", header: "Site" },
  { accessorKey: "name", header: "Name" },
  { accessorKey: "city", header: "City" },
  { accessorKey: "land_tier", header: "Tier" },
  { accessorKey: "verdict", header: "Verdict" },
  { accessorKey: "spare_ac_own", header: "Own ac" },
  { accessorKey: "spare_ac_adjoining", header: "Adjoining ac" },
  { accessorKey: "utility_proximity", header: "Utility proximity" },
  { accessorKey: "tenure", header: "Tenure" },
  { accessorKey: "listed", header: "Listed", cell: ({ getValue }) => yesNo(getValue()) },
  { accessorKey: "contacted", header: "Contacted", cell: ({ getValue }) => yesNo(getValue()) },
  { accessorKey: "asking_price_display", header: "Asking" },
  {
    id: "why",
    accessorKey: "why_stopped",
    header: "Why",
    cell: ({ getValue }) => {
      const value = String(getValue() || "");
      return value ? <span className="why" title={value}>{value}</span> : "—";
    },
  },
];

export default function SiteTable({
  rows,
  selectedId,
  onSelect,
}: {
  rows: SiteProps[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const showWhy = rows.some((row) => row.why_stopped);
  const table = useLegacyTable({
    data: rows,
    columns: showWhy ? columns : columns.filter((column) => column.id !== "why"),
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
              {group.headers.map((header) => (
                <th key={header.id} onClick={header.column.getToggleSortingHandler()}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
                  {{ asc: " ↑", desc: " ↓" }[header.column.getIsSorted() as string] ?? ""}
                </th>
              ))}
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
    </div>
  );
}

const dealColumns: LegacyColumnDef<DealProps>[] = [
  { accessorKey: "deal_id", header: "Deal" },
  { accessorKey: "name", header: "Name" },
  { accessorKey: "city", header: "City" },
  { accessorKey: "stage", header: "Stage" },
  { accessorKey: "firm", header: "Firm" },
  { accessorKey: "broker", header: "Broker" },
  { accessorKey: "asking_price_display", header: "Asking" },
  { accessorKey: "miles_to_depot", header: "Depot mi" },
  { accessorKey: "universe_id", header: "Universe site" },
];

export function DealTable({
  rows,
  selectedId,
  onSelect,
}: {
  rows: DealProps[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useLegacyTable({
    data: rows,
    columns: dealColumns,
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
              {group.headers.map((header) => (
                <th key={header.id} onClick={header.column.getToggleSortingHandler()}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
                  {{ asc: " ↑", desc: " ↓" }[header.column.getIsSorted() as string] ?? ""}
                </th>
              ))}
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
    </div>
  );
}
