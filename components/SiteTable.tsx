"use client";

import { useState, type ReactNode } from "react";
import { flexRender } from "@tanstack/react-table";
import {
  getCoreRowModel,
  getSortedRowModel,
  useLegacyTable,
  type LegacyColumnDef,
} from "@tanstack/react-table/legacy";
import type { SiteProps } from "@/lib/types";

type SortingState = { id: string; desc: boolean }[];

const columns: LegacyColumnDef<SiteProps>[] = [
  { accessorKey: "site_id", header: "Site" },
  { accessorKey: "city", header: "City" },
  { accessorKey: "land_tier", header: "Tier" },
  { accessorKey: "verification", header: "Verification" },
  { accessorKey: "verdict", header: "Verdict" },
  { accessorKey: "spare_ac_own", header: "Own ac" },
  { accessorKey: "spare_ac_adjoining", header: "Adjoining ac" },
  { accessorKey: "grid_proxy", header: "Grid proxy" },
  { accessorKey: "tenure", header: "Tenure" },
  { accessorKey: "listed", header: "Listed" },
  { accessorKey: "contacted", header: "Contacted" },
  { accessorKey: "asking_price_display", header: "Asking" },
  { accessorKey: "pipeline_stage", header: "Pipeline" },
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
  const table = useLegacyTable({
    data: rows,
    columns,
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
