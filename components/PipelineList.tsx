"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DealProps } from "@/lib/types";
import {
  PIPELINE_COLUMNS,
  type PipelineColumnId,
  acresText,
  cashTile,
  checkedShort,
  compactMoney,
  depotLine,
  fullMoney,
  capacitySummary,
  factsForDeal,
  openLandText,
  vehiclesPerDay,
  summaryOf,
  acresTotal,
} from "@/lib/keyNumbers";
import { displayAddress, folderHref, listingHref, shownBroker, shownFirm, shownPriceSource } from "@/lib/format";
import { NEAR_TIP, contactDate, serviceAreaChip, serviceAreaColumn, serviceAreaShort } from "@/lib/cardStatus";
import { dealCategory } from "@/lib/categories";
import { cardNdaLabel } from "@/lib/nda";
import { RowLinks } from "./RowLinks";
import { stageDetail, stageTone } from "@/lib/labels";
import { NdaChip } from "./NdaChip";
import { StagePending } from "./StagePending";
import { SuggestedDropMark } from "./SuggestedDrop";

export type PipelineRow = {
  deal: DealProps;
  noPin: boolean;
  zoning?: string;
  apn?: string;
};

function typeLabel(deal: DealProps): string {
  const category = dealCategory(deal);
  if (category === "wash") return "Car wash";
  if (category === "auto") return "Auto service";
  if (category === "land") return "Land";
  if (category === "store") return "C-store";
  return "";
}

function cell(row: PipelineRow, id: PipelineColumnId, signedIn: boolean) {
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
  if (id === "traffic") return vehiclesPerDay(deal.trade_aadt) || "—";
  if (id === "cashFlow") {
    const cash = cashTile(deal);
    if (cash.hidden) return "";
    if (cash.value === "Not provided" || cash.value === "Vacant land, no business") return cash.value;
    return [cash.value, cash.note, cash.basis].filter(Boolean).join(" · ");
  }
  if (id === "depot") return depotLine(deal.miles_to_depot, !row.noPin);
  if (id === "address") return displayAddress(deal.address) || "—";
  if (id === "apn") return row.apn || deal.apn || "—";
  if (id === "zoning") return row.zoning || "—";
  if (id === "broker") return [shownBroker(deal), shownFirm(deal)].filter(Boolean).join(" · ") || "—";
  if (id === "area") return serviceAreaColumn(deal) || "—";
  if (id === "nda") return cardNdaLabel(deal, signedIn) || "—";
  if (id === "lastContact") return contactDate(deal.last_broker_contact) || "—";
  if (id === "nextStep") return (deal.next_step || "").trim() || "—";
  if (id === "type") return typeLabel(deal) || "—";
  return checkedShort(deal.checked_live) || "Not provided";
}

function sortValue(row: PipelineRow, id: PipelineColumnId) {
  const deal = row.deal;
  if (id === "asking") return deal.asking_price;
  if (id === "acres") return deal.land_acres;
  if (id === "perAcre") return deal.price_per_acre;
  if (id === "openLand") return deal.open_land_sqft;
  if (id === "capacity") return deal.cap_a_substation_mi;
  if (id === "traffic") return deal.trade_aadt;
  if (id === "cashFlow") return deal.stated_cash_flow;
  if (id === "depot") return row.noPin ? null : deal.miles_to_depot;
  return null;
}

function maxOf(rows: PipelineRow[], read: (row: PipelineRow) => number | null | undefined) {
  let max = 0;
  for (const row of rows) {
    const value = read(row);
    if (value == null || !Number.isFinite(value)) continue;
    max = Math.max(max, Math.abs(value));
  }
  return max || 1;
}

export function pipelineCsv(rows: PipelineRow[], columns: PipelineColumnId[], signedIn = true) {
  const header = columns.map((id) => PIPELINE_COLUMNS.find((column) => column.id === id)?.label || id);
  const lines = [
    header.join(","),
    ...rows.map((row) => columns.map((id) => `"${cell(row, id, signedIn).replaceAll('"', '""')}"`).join(",")),
  ];
  return lines.join("\n");
}

export default function PipelineList({
  rows,
  columns,
  selectedId,
  sort,
  onSort,
  onOpen,
  onShowMap,
  onColumns,
  onResetColumns,
  unreadIds,
  signedIn = false,
  canAct = false,
  onBroker,
  onCompare,
  onCopyLink,
  onComment,
  onDrop,
}: {
  rows: PipelineRow[];
  columns: PipelineColumnId[];
  selectedId: string | null;
  sort: { id: PipelineColumnId; desc: boolean };
  onSort: (id: PipelineColumnId, desc?: boolean) => void;
  onOpen: (id: string) => void;
  onShowMap: (id: string) => void;
  onColumns: (next: PipelineColumnId[]) => void;
  onResetColumns: () => void;
  unreadIds?: string[];
  signedIn?: boolean;
  canAct?: boolean;
  onBroker?: (name: string) => void;
  onCompare?: (ids: string[]) => void;
  onCopyLink?: (ids: string[]) => Promise<void> | void;
  onComment?: (ids: string[], note: string) => Promise<void>;
  onDrop?: (ids: string[], reason: string) => Promise<void>;
}) {
  const unread = new Set(unreadIds || []);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [phone, setPhone] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [commentOpen, setCommentOpen] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState("");
  const [copied, setCopied] = useState(false);
  const skipClick = useRef(false);
  const holdTimer = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
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
      const diff = cell(a, sort.id, signedIn).localeCompare(cell(b, sort.id, signedIn), undefined, { numeric: true });
      return sort.desc ? -diff : diff;
    });
    return copy;
  }, [rows, sort, signedIn]);
  const scales = useMemo(() => ({
    asking: maxOf(ordered, (row) => row.deal.asking_price),
    acres: maxOf(ordered, (row) => row.deal.land_acres),
    perAcre: maxOf(ordered, (row) => row.deal.price_per_acre),
    traffic: maxOf(ordered, (row) => row.deal.trade_aadt),
    depot: maxOf(ordered, (row) => (row.noPin ? null : row.deal.miles_to_depot)),
    cash: maxOf(ordered, (row) => row.deal.stated_cash_flow),
    capacity: maxOf(ordered, (row) => row.deal.cap_a_substation_mi),
  }), [ordered]);
  const visibleIds = ordered.map((row) => row.deal.deal_id);
  const pickedSet = new Set(picked.filter((id) => visibleIds.includes(id)));
  const pickedRows = ordered.filter((row) => pickedSet.has(row.deal.deal_id));
  const showChecks = !phone || selecting;
  const allOn = visibleIds.length > 0 && visibleIds.every((id) => pickedSet.has(id));

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const apply = () => setPhone(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return undefined;
    const onScroll = () => node.classList.toggle("is-scrolled", node.scrollLeft > 4);
    onScroll();
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const scroll = scrollRef.current;
    const bar = barRef.current;
    if (!scroll) return undefined;
    if (!bar) {
      scroll.style.paddingBottom = "";
      return undefined;
    }
    const apply = () => {
      scroll.style.paddingBottom = `${Math.ceil(bar.getBoundingClientRect().height)}px`;
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      scroll.style.paddingBottom = "";
    };
  }, [pickedRows.length, phone]);

  function toggleColumn(id: PipelineColumnId) {
    if (id === "site") return;
    const next = columns.includes(id) ? columns.filter((item) => item !== id) : [...columns, id];
    const orderedIds = PIPELINE_COLUMNS.map((column) => column.id).filter((item) => next.includes(item));
    onColumns(orderedIds);
  }

  function toggleRow(id: string) {
    setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function toggleAll() {
    setPicked(allOn ? [] : visibleIds);
  }

  function download(target: PipelineRow[]) {
    const blob = new Blob([pipelineCsv(target, columns, signedIn)], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "pipeline.csv";
    link.click();
  }

  async function submitComment() {
    if (!onComment || !note.trim() || !pickedRows.length) return;
    setPending(true);
    setActionError("");
    try {
      await onComment(pickedRows.map((row) => row.deal.deal_id), note.trim());
      setCommentOpen(false);
      setNote("");
      setPicked([]);
      setSelecting(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The note could not be saved.");
    } finally {
      setPending(false);
    }
  }

  async function submitDrop() {
    if (!onDrop || !reason.trim() || !pickedRows.length) return;
    setPending(true);
    setActionError("");
    try {
      await onDrop(pickedRows.map((row) => row.deal.deal_id), reason.trim());
      setDropOpen(false);
      setReason("");
      setPicked([]);
      setSelecting(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The drop could not be submitted.");
    } finally {
      setPending(false);
    }
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
            {columns.flatMap((id) => {
              const column = PIPELINE_COLUMNS.find((item) => item.id === id);
              if (!column) return [];
              return [
                <option key={`${column.id}:asc`} value={`${column.id}:asc`}>{column.label}, low to high</option>,
                <option key={`${column.id}:desc`} value={`${column.id}:desc`}>{column.label}, high to low</option>,
              ];
            })}
          </select>
        </label>
        <button type="button" className="paper-btn only-mobile" onClick={() => { setSelecting((value) => !value); setPicked([]); }}>{selecting ? "Done" : "Select"}</button>
        {selecting ? (
          <label className="row-check only-mobile">
            <input className="check" type="checkbox" aria-label="Select all shown" checked={allOn} onChange={toggleAll} />
          </label>
        ) : null}
        <button type="button" className="paper-btn" onClick={() => download(ordered)}>Export CSV</button>
      </div>
      <div className="list-scroll" ref={scrollRef}>
        <table className="list-table">
          <thead>
            <tr>
              {columns.map((id) => {
                const column = PIPELINE_COLUMNS.find((item) => item.id === id);
                const active = sort.id === id;
                return (
                  <th key={id} className={id === "capacity" ? "capacity" : undefined} aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}>
                    {id === "site" && showChecks ? (
                      <label className="row-check">
                        <input className="check" type="checkbox" aria-label="Select all shown" checked={allOn} onChange={toggleAll} />
                      </label>
                    ) : null}
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
                  {columns.map((column) => (
                    <td key={column} className={column === "capacity" ? "capacity" : undefined}>
                      {column === "openLand" && row.deal.open_land_sqft != null ? (
                        <Meter text={cell(row, column, signedIn)} value={row.deal.open_land_sqft} max={maxOpen} />
                      ) : column === "asking" ? (
                        <AskingCell deal={row.deal} max={scales.asking} onBroker={onBroker} />
                      ) : column === "acres" ? (
                        <Meter text={cell(row, column, signedIn)} value={row.deal.land_acres} max={scales.acres} />
                      ) : column === "perAcre" ? (
                        <Meter text={cell(row, column, signedIn)} value={row.deal.price_per_acre} max={scales.perAcre} />
                      ) : column === "traffic" ? (
                        <Meter text={cell(row, column, signedIn)} value={row.deal.trade_aadt} max={scales.traffic} />
                      ) : column === "depot" ? (
                        row.noPin ? <span className="no-pin">No pin</span> : <Meter text={cell(row, column, signedIn)} value={row.deal.miles_to_depot} max={scales.depot} invert title="Closer to the depot is a shorter bar" />
                      ) : column === "cashFlow" ? (
                        cashTile(row.deal).hidden ? null : <Meter text={cell(row, column, signedIn)} value={row.deal.stated_cash_flow} max={scales.cash} negative={row.deal.stated_cash_flow != null && row.deal.stated_cash_flow < 0} />
                      ) : column === "capacity" ? (
                        <Meter text={cell(row, column, signedIn)} value={row.deal.cap_a_substation_mi} max={scales.capacity} invert title="Closer to a substation is a shorter bar" />
                      ) : column === "stage" ? (
                        <span className="stage-cell">
                          <span className={`stage-pill tone-${stageTone(row.deal)}`}>{cell(row, column, signedIn)}</span>
                          <NdaChip deal={row.deal} signedIn={signedIn} />
                          <SuggestedDropMark compact reason={row.deal.suggested_drop} stageGroup={row.deal.stage_group} stage={row.deal.stage} />
                          <StagePending note={row.deal.stage_pending} />
                        </span>
                      ) : column === "site" ? (
                        <span className="site-name">
                          {showChecks ? (
                            <label className="row-check">
                              <input className="check" type="checkbox" aria-label={`Select ${row.deal.name || id}`} checked={pickedSet.has(id)} onChange={() => toggleRow(id)} />
                            </label>
                          ) : null}
                          <span className="site-title">
                            <span className="site-name-text">
                              {unread.has(row.deal.deal_id) ? <i className="queue-dot" data-testid="queue-dot" aria-label="In your review" /> : null}
                              {cell(row, column, signedIn)}
                            </span>
                            {displayAddress(row.deal.address) && displayAddress(row.deal.address) !== (row.deal.name || "").trim() ? (
                              <span className="site-address">{displayAddress(row.deal.address)}</span>
                            ) : null}
                            <NearMark deal={row.deal} />
                          </span>
                          <RowLinks listing={listingHref(row.deal.listing_url)} folder={folderHref(row.deal.folder_url)} packageHref={row.deal.package_href} />
                        </span>
                      ) : (
                        cell(row, column, signedIn)
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
              {showChecks ? (
                <label className="row-check">
                  <input className="check" type="checkbox" aria-label={`Select ${row.deal.name || row.deal.deal_id}`} checked={pickedSet.has(row.deal.deal_id)} onChange={() => toggleRow(row.deal.deal_id)} />
                </label>
              ) : null}
              <button
                type="button"
                className={row.deal.deal_id === selectedId ? "list-row on" : "list-row"}
                onPointerDown={() => {
                  skipClick.current = false;
                  if (holdTimer.current) window.clearTimeout(holdTimer.current);
                  holdTimer.current = window.setTimeout(() => {
                    skipClick.current = true;
                    setSelecting(true);
                    setPicked((current) => current.includes(row.deal.deal_id) ? current : [...current, row.deal.deal_id]);
                  }, 480);
                }}
                onPointerUp={() => { if (holdTimer.current) window.clearTimeout(holdTimer.current); }}
                onPointerLeave={() => { if (holdTimer.current) window.clearTimeout(holdTimer.current); }}
                onClick={() => {
                  if (skipClick.current) {
                    skipClick.current = false;
                    return;
                  }
                  onOpen(row.deal.deal_id);
                }}
              >
                <strong>{unread.has(row.deal.deal_id) ? <i className="queue-dot" data-testid="queue-dot" aria-label="In your review" /> : null}{row.deal.name || row.deal.address}</strong>
                {displayAddress(row.deal.address) && displayAddress(row.deal.address) !== (row.deal.name || "").trim() ? <span className="site-address">{displayAddress(row.deal.address)}</span> : null}
                <NearMark deal={row.deal} />
                <span>{dealAsking(row)} · {acresText(row.deal.land_acres) || "Acres not provided"}</span>
                <span>{vehiclesPerDay(row.deal.trade_aadt) || "—"}</span>
                <span>
                  {row.deal.open_land_sqft != null ? openLandText(row.deal.open_land_sqft) : "Spare land not measured"}
                  {" · "}
                  Site capacity {capacitySummary(factsForDeal(row.deal))}
                </span>
                <NdaChip deal={row.deal} signedIn={signedIn} />
                <SuggestedDropMark compact reason={row.deal.suggested_drop} stageGroup={row.deal.stage_group} stage={row.deal.stage} />
                <StagePending note={row.deal.stage_pending} />
                {row.noPin ? <span className="no-pin">No pin</span> : null}
              </button>
              <span className="list-card-actions">
                <RowLinks listing={listingHref(row.deal.listing_url)} folder={folderHref(row.deal.folder_url)} packageHref={row.deal.package_href} />
                <button type="button" className="text-link" onClick={() => onShowMap(row.deal.deal_id)}>{row.noPin ? "No pin" : "Show on map"}</button>
              </span>
            </li>
          ))}
        </ul>
      </div>
      {pickedRows.length ? (
        <div className="selection-bar" data-testid="selection-bar" ref={barRef}>
          <p>{pickedRows.length.toLocaleString()} selected</p>
          <button type="button" className="paper-btn" disabled={pickedRows.length < 2 || pickedRows.length > 4} title="Opens the compare view for 2 to 4 sites" onClick={() => onCompare?.(pickedRows.map((row) => row.deal.deal_id))}>Compare</button>
          <button type="button" className="paper-btn" onClick={() => download(pickedRows)}>Export CSV</button>
          <button type="button" className="paper-btn" onClick={() => { void Promise.resolve(onCopyLink?.(pickedRows.map((row) => row.deal.deal_id))).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }); }}>{copied ? "Link copied" : "Copy link"}</button>
          {canAct && onComment ? <button type="button" className="paper-btn" onClick={() => { setActionError(""); setCommentOpen(true); }}>Comment</button> : null}
          {canAct && onDrop ? <button type="button" className="paper-btn" onClick={() => { setActionError(""); setDropOpen(true); }}>Drop with reason</button> : null}
        </div>
      ) : null}
      {commentOpen ? (
        <div className="list-dialog">
          <div className="popover" role="dialog" aria-label="Comment">
            <div className="popover-head">
              <h2>Comment</h2>
              <button type="button" className="close" aria-label="Close comment" onClick={() => setCommentOpen(false)}><span aria-hidden="true">×</span></button>
            </div>
            <p className="filter-note">One note is added to each selected site, on the same note path as a single comment.</p>
            <ul className="pick-list">{pickedRows.map((row) => <li key={row.deal.deal_id}>{row.deal.name || row.deal.deal_id}</li>)}</ul>
            <label>
              Note
              <textarea className="field" aria-label="Note" value={note} rows={3} maxLength={4000} onChange={(event) => setNote(event.target.value)} />
            </label>
            {actionError ? <p className="err">{actionError}</p> : null}
            <button type="button" className="primary" disabled={pending || !note.trim()} onClick={() => void submitComment()}>Add note</button>
          </div>
        </div>
      ) : null}
      {dropOpen ? (
        <div className="list-dialog">
          <div className="popover" role="dialog" aria-label="Drop with a reason">
            <div className="popover-head">
              <h2>Drop with a reason</h2>
              <button type="button" className="close" aria-label="Close drop" onClick={() => setDropOpen(false)}><span aria-hidden="true">×</span></button>
            </div>
            <p className="filter-note">Each site is submitted for approval with this reason. Nothing is dropped until someone approves it.</p>
            <ul className="pick-list">{pickedRows.map((row) => <li key={row.deal.deal_id}>{row.deal.name || row.deal.deal_id}</li>)}</ul>
            <label>
              Reason
              <textarea className="field" aria-label="Reason" value={reason} rows={3} maxLength={2000} onChange={(event) => setReason(event.target.value)} />
            </label>
            {actionError ? <p className="err">{actionError}</p> : null}
            <button type="button" className="primary" disabled={pending || !reason.trim()} onClick={() => void submitDrop()}>Submit for approval</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function dealAsking(row: PipelineRow) {
  return row.deal.asking_price_display || "Asking not provided";
}

function NearMark({ deal }: { deal: DealProps }) {
  const label = serviceAreaChip(deal);
  if (!label || deal.service_area_class === "outside") return null;
  if (deal.service_area_class !== "near_0_5" && deal.service_area_class !== "near_5_10") return null;
  return <span className="badge quiet near-chip" data-testid="near-chip" data-short={serviceAreaShort(deal)} title={NEAR_TIP}>{label}</span>;
}

function Meter({
  text,
  value,
  max,
  invert = false,
  negative = false,
  title,
}: {
  text: string;
  value?: number | null;
  max: number;
  invert?: boolean;
  negative?: boolean;
  title?: string;
}) {
  if (value == null || !Number.isFinite(value) || !text) return <span>{text || "—"}</span>;
  const width = Math.max(6, Math.min(100, (Math.abs(value) / max) * 100));
  const tone = negative ? "neg" : invert ? "invert" : "";
  return (
    <span className="metric">
      <span className="metric-label">{text}</span>
      <i className={tone} title={title}><b style={{ width: `${width}%` }} /></i>
    </span>
  );
}

function AskingCell({ deal, max, onBroker }: { deal: DealProps; max: number; onBroker?: (name: string) => void }) {
  const price = deal.asking_price_display;
  if (!price) return <span>Not provided</span>;
  const source = shownPriceSource(deal);
  const listing = listingHref(deal.listing_url);
  const party = shownBroker(deal) || shownFirm(deal);
  const sourceNode = !source ? null : listing ? (
    <a className="text-link" href={listing} target="_blank" rel="noopener noreferrer" title="Opens the listing" onClick={(event) => event.stopPropagation()}>{source}</a>
  ) : party && onBroker ? (
    <button type="button" className="text-link" title="Filters the list to this broker" onClick={(event) => { event.stopPropagation(); onBroker(party); }}>{source}</button>
  ) : (
    source
  );
  const width = deal.asking_price == null ? 0 : Math.max(6, Math.min(100, (Math.abs(deal.asking_price) / max) * 100));
  return (
    <span className="metric">
      <span className="metric-label">{price}{sourceNode ? <> · {sourceNode}</> : null}</span>
      {deal.asking_price != null ? <i title="Bar length follows the asking price in this list"><b style={{ width: `${width}%` }} /></i> : null}
    </span>
  );
}
