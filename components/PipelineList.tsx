"use client";

import { useMemo, useState } from "react";
import type { DealProps } from "@/lib/types";
import {
  PIPELINE_COLUMNS,
  type PipelineColumnId,
  type RangeFilter,
  acresText,
  cashTile,
  checkedShort,
  compactMoney,
  depotLine,
  fullMoney,
  capacitySummary,
  factsForDeal,
  openLandText,
  workbookTrafficLine,
  summaryOf,
  acresTotal,
} from "@/lib/keyNumbers";
import { listingCue, shownPriceSource } from "@/lib/format";
import { stageDetail, stageTone } from "@/lib/labels";
import { NdaChip } from "./NdaChip";
import { SuggestedDropMark } from "./SuggestedDrop";

export type PipelineRow = {
  deal: DealProps;
  noPin: boolean;
};

function cell(row: PipelineRow, id: PipelineColumnId) {
  const deal = row.deal;
  if (id === "site") return deal.name || deal.address || deal.deal_id;
  if (id === "stage") return stageDetail(deal.stage, deal.stage_group);
  if (id === "asking") {
    if (!deal.asking_price_display) return "Not provided";
    const source = shownPriceSource(deal);
    return source ? `${deal.asking_price_display} · ${source}` : deal.asking_price_display;
  }
  if (id === "acres") return acresText(deal.land_acres) || "Not provided";
  if (id === "perAcre") return deal.price_per_acre_display || "Not provided";
  if (id === "openLand") return deal.open_land_sqft != null ? openLandText(deal.open_land_sqft) : "Not measured";
  if (id === "capacity") return capacitySummary(factsForDeal(deal));
  if (id === "traffic") return workbookTrafficLine(deal) || "Not provided";
  if (id === "cashFlow") {
    const cash = cashTile(deal);
    if (cash.hidden) return "";
    if (cash.value === "Not provided" || cash.value === "Vacant land, no business") return cash.value;
    return [cash.value, cash.note, cash.basis].filter(Boolean).join(" · ");
  }
  if (id === "depot") return depotLine(deal.miles_to_depot, !row.noPin);
  return checkedShort(deal.checked_live) || "Not provided";
}

function sortValue(row: PipelineRow, id: PipelineColumnId) {
  const deal = row.deal;
  if (id === "asking") return deal.asking_price;
  if (id === "acres") return deal.land_acres;
  if (id === "perAcre") return deal.price_per_acre;
  if (id === "openLand") return deal.open_land_sqft;
  if (id === "capacity") return factsForDeal(deal).length;
  if (id === "traffic") return deal.trade_aadt;
  if (id === "cashFlow") return deal.stated_cash_flow;
  if (id === "depot") return row.noPin ? null : deal.miles_to_depot;
  return null;
}

export function pipelineCsv(rows: PipelineRow[], columns: PipelineColumnId[]) {
  const header = columns.map((id) => PIPELINE_COLUMNS.find((column) => column.id === id)?.label || id);
  const lines = [
    header.join(","),
    ...rows.map((row) => columns.map((id) => `"${cell(row, id).replaceAll('"', '""')}"`).join(",")),
  ];
  return lines.join("\n");
}

export default function PipelineList({
  rows,
  columns,
  selectedId,
  compareIds,
  sort,
  ranges,
  onSort,
  onOpen,
  onShowMap,
  onCompare,
  onColumns,
  onResetColumns,
  onRanges,
  unreadIds,
}: {
  rows: PipelineRow[];
  columns: PipelineColumnId[];
  selectedId: string | null;
  compareIds: string[];
  sort: { id: PipelineColumnId; desc: boolean };
  ranges: RangeFilter;
  onSort: (id: PipelineColumnId, desc?: boolean) => void;
  onOpen: (id: string) => void;
  onShowMap: (id: string) => void;
  onCompare: (id: string, on: boolean) => void;
  onColumns: (next: PipelineColumnId[]) => void;
  onResetColumns: () => void;
  onRanges: (next: RangeFilter) => void;
  unreadIds?: string[];
}) {
  const unread = new Set(unreadIds || []);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const maxOpen = Math.max(1, ...rows.map((row) => row.deal.open_land_sqft || 0));
  const summary = useMemo(() => summaryOf(rows.map((row) => row.deal)), [rows]);
  const ordered = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const leftNumber = sortValue(a, sort.id);
      const rightNumber = sortValue(b, sort.id);
      if (leftNumber != null || rightNumber != null) {
        if (leftNumber == null) return 1;
        if (rightNumber == null) return -1;
        const diff = leftNumber - rightNumber;
        return sort.desc ? -diff : diff;
      }
      const diff = cell(a, sort.id).localeCompare(cell(b, sort.id), undefined, { numeric: true });
      return sort.desc ? -diff : diff;
    });
    return copy;
  }, [rows, sort]);

  function toggleColumn(id: PipelineColumnId) {
    if (id === "site") return;
    const next = columns.includes(id) ? columns.filter((item) => item !== id) : [...columns, id];
    const orderedIds = PIPELINE_COLUMNS.map((column) => column.id).filter((item) => next.includes(item));
    onColumns(orderedIds);
  }

  function setRange(key: keyof RangeFilter, raw: string) {
    const value = raw.trim() === "" ? null : Number(raw);
    onRanges({ ...ranges, [key]: value != null && Number.isFinite(value) ? value : null });
  }

  return (
    <div className="list-pane pipeline-list" data-list-count={rows.length} data-testid="pipeline-list">
      <div className="summary-row" data-testid="summary-row">
        <div><span>In this filter</span><strong>{summary.count.toLocaleString()}</strong><small>{summary.withAsking} with an asking price</small></div>
        <div><span>Median asking</span><strong>{summary.medianAsking == null ? "Not provided" : fullMoney(summary.medianAsking)}</strong></div>
        <div><span>Land listed</span><strong>{acresTotal(summary.totalAcres)}</strong></div>
        <div><span>Median per acre</span><strong>{summary.medianPerAcre == null ? "Not provided" : compactMoney(summary.medianPerAcre)}</strong></div>
      </div>
      <div className="list-bar">
        <p>{rows.length.toLocaleString()} shown</p>
        <div className="col-picker only-desktop">
          <button type="button" className="paper-btn" aria-expanded={columnsOpen} onClick={() => setColumnsOpen((value) => !value)}>Columns</button>
          {columnsOpen ? (
            <div className="menu" role="group" aria-label="Columns">
              <button type="button" className="text-link" onClick={onResetColumns}>Pipeline default</button>
              {PIPELINE_COLUMNS.map((column) => (
                <label key={column.id}>
                  <input className="check" type="checkbox" checked={columns.includes(column.id)} disabled={column.id === "site"} onChange={() => toggleColumn(column.id)} />
                  {column.label}
                </label>
              ))}
            </div>
          ) : null}
        </div>
        <label className="list-sort only-mobile">
          Sort
          <select
            className="secondary"
            aria-label="Sort"
            value={`${sort.id}:${sort.desc ? "desc" : "asc"}`}
            onChange={(event) => {
              const [id, direction] = event.target.value.split(":");
              onSort(id as PipelineColumnId, direction === "desc");
            }}
          >
            {PIPELINE_COLUMNS.flatMap((column) => [
              <option key={`${column.id}:asc`} value={`${column.id}:asc`}>{column.label}, low to high</option>,
              <option key={`${column.id}:desc`} value={`${column.id}:desc`}>{column.label}, high to low</option>,
            ])}
          </select>
        </label>
        <button type="button" className="paper-btn" onClick={() => setFiltersOpen((value) => !value)}>{filtersOpen ? "Hide filters" : "Filters"}</button>
        <button type="button" className="paper-btn" onClick={() => {
          const blob = new Blob([pipelineCsv(ordered, columns)], { type: "text/csv" });
          const link = document.createElement("a");
          link.href = URL.createObjectURL(blob);
          link.download = "pipeline.csv";
          link.click();
        }}>Export CSV</button>
      </div>
      {filtersOpen ? (
        <div className="range-filters">
          {(
            [
              ["Asking", "$", "askMin", "askMax"],
              ["Acres", "ac", "acMin", "acMax"],
              ["Per acre", "$/ac", "paMin", "paMax"],
              ["Open land", "sq ft", "olMin", "olMax"],
            ] as const
          ).map(([label, unit, minKey, maxKey]) => (
            <label key={label}>
              {label} ({unit})
              <input className="field" aria-label={`${label} minimum`} placeholder="Min" inputMode="decimal" value={ranges[minKey] ?? ""} onChange={(event) => setRange(minKey, event.target.value)} />
              <input className="field" aria-label={`${label} maximum`} placeholder="Max" inputMode="decimal" value={ranges[maxKey] ?? ""} onChange={(event) => setRange(maxKey, event.target.value)} />
            </label>
          ))}
        </div>
      ) : null}
      <div className="list-scroll">
        <table className="list-table">
          <thead>
            <tr>
              <th aria-sort="none"><span className="sr">Compare</span></th>
              {columns.map((id) => {
                const column = PIPELINE_COLUMNS.find((item) => item.id === id);
                const active = sort.id === id;
                return (
                  <th key={id} className={id === "capacity" ? "capacity" : undefined} aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}>
                    <button type="button" className="sort-header" onClick={() => onSort(id)}>
                      {column?.label}
                      {active ? (sort.desc ? " ↓" : " ↑") : ""}
                    </button>
                  </th>
                );
              })}
              <th aria-sort="none"><span className="sr">Map</span></th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((row) => {
              const id = row.deal.deal_id;
              return (
                <tr key={id} className={id === selectedId ? "list-row on" : "list-row"} onClick={(event) => {
                  if ((event.target as HTMLElement).closest("input, button, a")) return;
                  onOpen(id);
                }}>
                  <td>
                    <input
                      className="check"
                      type="checkbox"
                      aria-label={`Compare ${row.deal.name || id}`}
                      checked={compareIds.includes(id)}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => onCompare(id, event.currentTarget.checked)}
                    />
                  </td>
                  {columns.map((column) => (
                    <td key={column} className={column === "capacity" ? "capacity" : undefined}>
                      {column === "openLand" && row.deal.open_land_sqft != null ? (
                        <span className="open-land">
                          {cell(row, column)}
                          <i><b style={{ width: `${row.deal.open_land_sqft > 0 ? Math.max(8, (row.deal.open_land_sqft / maxOpen) * 100) : 0}%` }} /></i>
                        </span>
                      ) : column === "depot" && row.noPin ? (
                        <span className="no-pin">No pin</span>
                      ) : column === "stage" ? (
                        <span className="stage-cell">
                          <span className={`stage-pill tone-${stageTone(row.deal)}`}>{cell(row, column)}</span>
                          <NdaChip deal={row.deal} />
                          <SuggestedDropMark reason={row.deal.suggested_drop} stageGroup={row.deal.stage_group} stage={row.deal.stage} />
                        </span>
                      ) : column === "capacity" ? (
                        <span className="capacity-cell" title={factsForDeal(row.deal).map((fact) => fact.basis).filter(Boolean).join(" · ")}>{cell(row, column)}</span>
                      ) : column === "site" ? (
                        <span className="site-name">
                          {unread.has(row.deal.deal_id) ? <i className="queue-dot" data-testid="queue-dot" aria-label="In your review" /> : null}
                          <span className="site-name-text">{cell(row, column)}</span>
                          <ListingIcon deal={row.deal} />
                        </span>
                      ) : (
                        cell(row, column)
                      )}
                    </td>
                  ))}
                  <td>
                    <button type="button" className="text-link" onClick={(event) => { event.stopPropagation(); onShowMap(id); }}>{row.noPin ? "No pin" : "Show on map"}</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <ul className="list-cards">
          {ordered.map((row) => (
            <li key={row.deal.deal_id}>
              <button type="button" className={row.deal.deal_id === selectedId ? "list-row on" : "list-row"} onClick={() => onOpen(row.deal.deal_id)}>
                <strong>{unread.has(row.deal.deal_id) ? <i className="queue-dot" data-testid="queue-dot" aria-label="In your review" /> : null}{row.deal.name || row.deal.address}</strong>
                <span>{dealAsking(row)} · {acresText(row.deal.land_acres) || "Acres not provided"}</span>
                <span>
                  {row.deal.open_land_sqft != null ? openLandText(row.deal.open_land_sqft) : "Spare land not measured"}
                  {" · "}
                  Site capacity {capacitySummary(factsForDeal(row.deal))}
                </span>
                <NdaChip deal={row.deal} />
                <SuggestedDropMark reason={row.deal.suggested_drop} stageGroup={row.deal.stage_group} stage={row.deal.stage} />
                {row.noPin ? <span className="no-pin">No pin</span> : null}
              </button>
              <button type="button" className="text-link" onClick={() => onShowMap(row.deal.deal_id)}>{row.noPin ? "No pin" : "Show on map"}</button>
              <ListingIcon deal={row.deal} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function dealAsking(row: PipelineRow) {
  return row.deal.asking_price_display || "Asking not provided";
}

function ListingIcon({ deal }: { deal: DealProps }) {
  const cue = listingCue(deal);
  const icon = (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
  if (!cue.url) {
    return <span className="listing-icon muted" title={cue.label} aria-label={cue.label}>{icon}</span>;
  }
  return (
    <a className={`listing-icon${deal.listing_removed ? " removed" : ""}`} href={cue.url} target="_blank" rel="noopener noreferrer" title={cue.label} aria-label={cue.label} onClick={(event) => event.stopPropagation()}>
      {icon}
    </a>
  );
}
