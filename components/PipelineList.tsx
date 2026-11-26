"use client";

import { useSearchParams } from "next/navigation";
import { reviewLink, rememberReviewPosition, restoreReviewPosition, setReviewFilter } from "@/lib/reviewNavigation";
import { FinanceFilters, financeMatch } from "./FinancialPortfolio";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DealProps } from "@/lib/types";
import { inMapArea, type MapArea } from "@/lib/geoFilter";
import { allowedIds, defaultLayout, displayIds, phoneColumns, prepareRows, sortFromParam, type ListLayout, type SheetColumn } from "@/lib/listLayout";
import SheetGrid from "./SheetGrid";
import { useListLayout } from "./useListLayout";
import {
  PIPELINE_COLUMNS,
  type PipelineColumnId,
  acresText,
  cashFlowListLabel,
  cashTile,
  checkedShort,
  compactMoney,
  depotLine,
  isOpenLandBlank,
  fullMoney,
  capacitySummary,
  listScoreText,
  factsForDeal,
  powerSummary,
  openLandLabel,
  openLandMeasured,
  openLandText,
  vehiclesPerDay,
  summaryOf,
  acresTotal,
} from "@/lib/keyNumbers";
import { basisBadge, compMedianOf } from "@/lib/pricing";
import { storedScoreView } from "@/lib/scoreDisplay";
import { marketBucket } from "@/lib/counts";
import { stripPlace, stripStats, stripTip, type StripDirection, type StripStats } from "@/lib/rangeStrip";
import { displayAddress, folderHref, listingHref, shownBroker, shownFirm, shownPriceSource } from "@/lib/format";
import { NEAR_TIP, contactDate, serviceAreaChip, serviceAreaColumn, serviceAreaShort } from "@/lib/cardStatus";
import { dealCategory } from "@/lib/categories";
import { cardNdaLabel } from "@/lib/nda";
import { RowLinks } from "./RowLinks";
import { CountyChip, LandPausedChip, ScoreCell, StageTypeCell, TypeChip } from "./ListLook";
import { ColumnPicker, EmptyShortlist, RowCheck, ShortlistSummary, SortControl, sharedStage } from "./ListChrome";
import { stageChipLabel } from "@/lib/chips";
import { droppedDecisionLine } from "@/lib/droppedLine";
import { isQuickLube, QUICK_LUBE_LABEL, stageTone } from "@/lib/labels";
import { plainNextStep } from "@/lib/nextStepLine";
import { stripGmailIds } from "@/lib/displayText";
import { chipsForDeal, suggestedDropChip } from "@/lib/tags/show";
import { columnFamily, tagFamily } from "@/lib/tags/vocab";
import { ReasonPicker } from "./ReasonPicker";
import { PhoneCards } from "./PhoneCards";
import { TagChip } from "./TagChip";
import { useNarrowList } from "./useNarrowList";
import { StagePending } from "./StagePending";

export type PipelineRow = {
  deal: DealProps;
  noPin: boolean;
  zoning?: string;
  apn?: string;
  countyLabel?: string;
  countyNote?: string;
  point?: [number, number] | null;
};

function typeLabel(deal: DealProps): string {
  const category = dealCategory(deal);
  if (category === "lube") return QUICK_LUBE_LABEL;
  if (category === "wash") return "Car wash";
  if (category === "auto") return "Auto service";
  if (category === "land") return "Land";
  if (category === "store") return "C-store";
  return "";
}

function phoneFact(value: string): string {
  return value.replace(/\s+/g, " ").replace(/^(?:·\s*)+/, "").replace(/(?:\s*·)+$/, "").trim();
}

function scoreInput(row: PipelineRow) {
  const deal = row.deal;
  return {
    score: deal.score,
    economics: deal.economics_points,
    land: deal.land_points,
    power: deal.power_points,
    location: deal.location_points,
    deal: deal.deal_points,
    naEconomics: isQuickLube(deal.business_type),
  };
}

function phoneFacts(row: PipelineRow, signedIn: boolean): string[] {
  const deal = row.deal;
  const asking = signedIn && deal.asking_price != null ? `${compactMoney(deal.asking_price)} asking` : "";
  const party = shownFirm(deal) || shownBroker(deal) || shownPriceSource(deal);
  const land = openLandLabel(deal.open_land_sqft, deal.open_land_basis);
  const openLand = isOpenLandBlank(land) ? "" : `${land} open`;
  return [asking, party, openLand].map(phoneFact).filter(Boolean);
}

function dealChips(deal: DealProps, signedIn: boolean) {
  return chipsForDeal({ ...deal }, signedIn);
}

function cell(row: PipelineRow, id: PipelineColumnId, signedIn: boolean) {
  const deal = row.deal;
  if (id === "site") return deal.name || deal.address || deal.deal_id;
  if (id === "stage") return stageChipLabel(deal.stage, deal.stage_group);
  if (id === "merit") return signedIn ? deal.charging?.merit.action ?? deal.screening?.priority ?? "—" : "";
  if (id === "county") return row.countyLabel || "—";
  if (id === "score") {
    const view = storedScoreView({
      score: deal.score,
      economics: deal.economics_points,
      land: deal.land_points,
      power: deal.power_points,
      location: deal.location_points,
      deal: deal.deal_points,
      naEconomics: deal.business_type === "Quick lube",
    });
    if (view.status === "not_scored") return "Not scored";
    if (view.status === "provisional") return `Provisional ${listScoreText(view.summed)}`;
    return listScoreText(view.chip);
  }
  if (id === "asking") {
    if (!signedIn) return "—";
    if (!deal.asking_price_display) return "—";
    const source = shownPriceSource(deal);
    return source ? `${deal.asking_price_display} · ${source}` : deal.asking_price_display;
  }
  if (id === "acres") return acresText(deal.land_acres) || "—";
  if (id === "perAcre") return signedIn ? (deal.price_per_acre_display || "—") : "—";
  if (id === "openLand") return openLandLabel(deal.open_land_sqft, deal.open_land_basis);
  if (id === "capacity") return powerSummary(factsForDeal(deal)) || "—";
  if (id === "traffic") return vehiclesPerDay(deal.trade_aadt) || "—";
  if (id === "cashFlow") {
    if (!signedIn) return "—";
    if (isQuickLube(deal.business_type)) return "N/A";
    const cash = cashTile(deal);
    if (cash.hidden) return "";
    if (cash.value === "—" || cash.value === "Vacant land, no business") return cash.value;
    return cashFlowListLabel(deal).text || "—";
  }
  if (id === "revenue" || id === "askingRevenue" || id === "askingCash" || id === "businessMultiple" || id === "landEstimate" || id === "countyValue") {
    if (!signedIn) return "—";
    if (id === "revenue") return deal.stated_revenue_display || "—";
    if (id === "askingRevenue") return deal.revenue_multiple_display && deal.revenue_multiple_display !== "—" ? deal.revenue_multiple_display : (deal.revenue_multiple_reason || "—");
    if (id === "askingCash") return deal.earnings_multiple_display && deal.earnings_multiple_display !== "—" ? deal.earnings_multiple_display : (deal.earnings_multiple_reason || "—");
    if (id === "businessMultiple") return deal.business_multiple_display && deal.business_multiple_display !== "—" ? deal.business_multiple_display : (deal.business_multiple_reason || "—");
    if (id === "landEstimate") return deal.land_estimate_display || deal.land_estimate_reason || "—";
    return deal.county_value_display || "—";
  }
  if (id === "depot") return depotLine(deal.miles_to_depot, !row.noPin);
  if (id === "address") return displayAddress(deal.address) || "—";
  if (id === "apn") return row.apn || deal.apn || "—";
  if (id === "zoning") return row.zoning || "—";
  if (id === "broker") return [shownBroker(deal), shownFirm(deal)].filter(Boolean).join(" · ") || "—";
  if (id === "area") return serviceAreaColumn(deal) || "—";
  if (id === "nda") {
    if (!signedIn) return "—";
    return dealChips(deal, signedIn).find((chip) => chip.family === "nda")?.label || cardNdaLabel(deal, signedIn) || "—";
  }
  if (id === "lastContact") return contactDate(deal.last_broker_contact) || "—";
  if (id === "nextStep") return stripGmailIds(String(deal.next_step || "").trim()) || "—";
  if (id === "type") return typeLabel(deal) || "—";
  const family = columnFamily(id);
  if (family) {
    if (!signedIn && family.signedIn) return "—";
    return dealChips(deal, signedIn).find((chip) => chip.family === family.family)?.label || "—";
  }
  return checkedShort(deal.checked_live) || "—";
}

const STAGE_CHOICES = [
  { code: "desk", label: "Desk screen" },
  { code: "financial", label: "Financial screen" },
  { code: "checks", label: "Site checks" },
  { code: "close", label: "Offer and close" },
  { code: "dropped", label: "Dropped" },
];

function stageFilterCode(deal: DealProps): string {
  if (deal.stage_group === "contacted") return "financial";
  if (deal.stage_group === "later") return "close";
  if (deal.stage_group === "sourced") return "desk";
  return deal.stage_group || "";
}

function sortValue(row: PipelineRow, id: PipelineColumnId, signedIn: boolean) {
  const deal = row.deal;
  if (id === "merit") return deal.charging?.merit.order ?? null;
  if (id === "asking") return signedIn ? deal.asking_price : null;
  if (id === "score") return typeof deal.score === "number" ? deal.score : null;
  if (id === "acres") return deal.land_acres;
  if (id === "perAcre") return signedIn ? deal.price_per_acre : null;
  if (id === "openLand") return openLandMeasured(deal.open_land_sqft, deal.open_land_basis) ? deal.open_land_sqft : null;
  if (id === "capacity") return deal.cap_a_substation_mi;
  if (id === "traffic") return deal.trade_aadt;
  if (id === "cashFlow") return signedIn ? deal.stated_cash_flow : null;
  if (id === "revenue") return signedIn ? deal.stated_revenue : null;
  if (id === "askingRevenue") return signedIn ? deal.revenue_multiple : null;
  if (id === "askingCash") return signedIn ? deal.earnings_multiple : null;
  if (id === "businessMultiple") return signedIn ? deal.business_multiple : null;
  if (id === "landEstimate") return signedIn ? deal.land_estimate : null;
  if (id === "countyValue") return signedIn ? deal.county_value : null;
  if (id === "depot") return row.noPin ? null : deal.miles_to_depot;
  return null;
}

function dropReason(deal: DealProps): string {
  if (deal.stage_group !== "dropped") return "";
  const chip = deal.chips?.find((item) => item.family === "drop_reason");
  return chip?.label || String((deal as DealProps & { stage_reason?: string }).stage_reason || "");
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function pipelineCsv(rows: PipelineRow[], columns: PipelineColumnId[], signedIn = true) {
  const fixed = ["Site ID", "Market", "Stage", "Drop reason"];
  const rest = columns.filter((id) => id !== "site" && id !== "stage" && id !== "chip_drop");
  const header = [...fixed, ...rest.map((id) => id==="score" ? "Score" : PIPELINE_COLUMNS.find((column) => column.id === id)?.label || id)];
  const lines = [
    header.join(","),
    ...rows.map((row) => {
      const lead = [row.deal.deal_id, marketBucket(row.deal.city), cell(row, "stage", signedIn), dropReason(row.deal)];
      const tail = rest.map((id) => cell(row, id, signedIn));
      return [...lead, ...tail].map(csvCell).join(",");
    }),
  ];
  return lines.join("\n");
}

export default function PipelineList({
  title,
  rows,
  outsideRow = null,
  columns,
  selectedId, initialSelection, onSelection, onScope,
  sort,
  onSort,
  onOpen,
  onFinancials,
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
  sortQuery,
  columnSeed,
  userId,
  mapArea,
  onClearArea,
  onDismiss,
}: {
  title: string;
  rows: PipelineRow[];
  outsideRow?: PipelineRow | null;
  columns: PipelineColumnId[];
  initialSelection?: string[];
  onSelection?: (ids: string[]) => void;
  onScope?: (ids: string[], layout: ListLayout) => void;
  selectedId: string | null;
  sort: { id: PipelineColumnId; desc: boolean };
  onSort: (id: PipelineColumnId, desc?: boolean) => void;
  onOpen: (id: string) => void;
  onFinancials?: (id:string)=>void;
  onShowMap: (id: string) => void;
  onColumns: (next: PipelineColumnId[]) => void;
  onResetColumns: () => void;
  unreadIds?: string[];
  signedIn?: boolean;
  canAct?: boolean;
  onBroker?: (name: string) => void;
  onCompare?: (ids: string[]) => void;
  onCopyLink?: (ids: string[]) => Promise<void> | void;
  onComment?: (ids: string[], note: string) => Promise<string[]>;
  onDrop?: (ids: string[], reason: string) => Promise<string[]>;
  sortQuery?: string | null;
  columnSeed?: string[] | null;
  userId?: string;
  mapArea?: MapArea | null;
  onSearchArea?: () => void;
  onClearArea?: () => void;
  onDismiss?: () => void;
}) {
  const unread = new Set(unreadIds || []);
  const [moreOpen, setMoreOpen] = useState(false);
  const allowed = useMemo(() => allowedIds(PIPELINE_COLUMNS.map((column) => column.id), signedIn), [signedIn]);
  const fallback = useMemo(() => {
    const optional = PIPELINE_COLUMNS.filter((column) => "optional" in column && column.optional).map((column) => column.id);
    const base=defaultLayout(allowed, ["site"], optional);
    if(signedIn)base.sort={id:"merit",desc:false};
    return base;
  }, [allowed,signedIn]);
  const seed = useMemo(() => (columnSeed?.length ? defaultLayout(allowed, ["site"], allowed.filter((id) => id !== "site" && !columnSeed.includes(id))) : null), [allowed, columnSeed]);
  const { layout, update } = useListLayout({
    surface: "pipeline",
    signedIn,
    userId: userId || "",
    allowed,
    seed,
    fallback,
  });
  const sortOverride = sortFromParam(sortQuery === undefined ? `${sort.id}:${sort.desc ? "desc" : "asc"}` : sortQuery, allowed);
  const activeLayout: ListLayout = sortOverride === undefined ? layout : { ...layout, sort: sortOverride };
  const paneRef = useRef<HTMLDivElement>(null);
  const phone = useNarrowList(paneRef);
  const [picked, setPicked] = useState<string[]>(initialSelection || []);
  useEffect(() => { onSelection?.(picked); }, [picked, onSelection]);
  const [commentOpen, setCommentOpen] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState("");
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const visible = displayIds(activeLayout, allowed, phone, phoneColumns("pipeline"));
  const sheetColumns: SheetColumn<PipelineRow>[] = visible.map((id) => {
    const family = columnFamily(id);
    const choices = id === "stage" ? STAGE_CHOICES : family?.codes.map((item) => ({ code: item.code, label: item.label }));
    const codeOf = (row: PipelineRow) => {
      if (id === "stage") return stageFilterCode(row.deal);
      return dealChips(row.deal, signedIn).find((chip) => chip.family === family?.family)?.code || "";
    };
    return {
      id,
      label: PIPELINE_COLUMNS.find((column) => column.id === id)?.label || id,
      className: id === "capacity" ? "power-col" : id === "stage" ? "stage-col" : undefined,
      customTip: id === "stage" || id === "score" || id === "county" || id === "type",
      text: (row) => cell(row, id as PipelineColumnId, signedIn),
      choices,
      hasValues: choices ? rows.some((row) => Boolean(codeOf(row))) : undefined,
      code: codeOf,
      sortValue: (row) => {
        const value = sortValue(row, id as PipelineColumnId, signedIn);
        return typeof value === "number" ? value : null;
      },
    };
  });
  const params=useSearchParams();
  const finEvidence=params.get("finEvidence") || "", finCarry=params.get("finCarry") || "";
  const financeOpen=params.get("finFilter")==="1";
  const ordered = useMemo(() => {
    const scoped = mapArea ? rows.filter((row) => row.point && inMapArea(row.point[0], row.point[1], mapArea)) : rows;
    return prepareRows(signedIn && financeOpen ? scoped.filter(r=>financeMatch(r.deal,finEvidence,finCarry)) : scoped, sheetColumns, activeLayout, visible);
  }, [activeLayout, mapArea, rows, sheetColumns, visible,signedIn,financeOpen,finEvidence,finCarry]);
  const scope = ordered.map(row=>row.deal.deal_id).join("|");
  const origin = "/?" + params;
  const listScroller = () => scrollRef.current || paneRef.current?.querySelector<HTMLElement>(".list-scroll") || null;
  const restoreKey = useRef("");
  useEffect(()=>{
    if (ordered.length && restoreKey.current!==origin) {
      const selection = restoreReviewPosition(listScroller());
      if (selection) setPicked(selection);
      restoreKey.current=origin;
    }
  },[ordered.length,origin,phone]);
  const summary = useMemo(() => summaryOf(ordered.map((row) => row.deal)), [ordered]);
  const compMedian = useMemo(() => compMedianOf(ordered.map((row) => row.deal)), [ordered]);
  const marketComps = new Map<string, number>();
  for (const { deal } of ordered) {
    if (signedIn && deal.city && deal.comp_median_per_acre != null) marketComps.set(deal.city, deal.comp_median_per_acre);
  }
  const strips = useMemo(() => ({
    asking: stripStats(ordered.map((row) => (signedIn ? row.deal.asking_price : null))),
    acres: stripStats(ordered.map((row) => row.deal.land_acres)),
    perAcre: stripStats(ordered.map((row) => (signedIn ? row.deal.price_per_acre : null))),
    openLand: stripStats(ordered.map((row) => (openLandMeasured(row.deal.open_land_sqft, row.deal.open_land_basis) ? row.deal.open_land_sqft : null))),
    traffic: stripStats(ordered.map((row) => row.deal.trade_aadt)),
    depot: stripStats(ordered.map((row) => (row.noPin ? null : row.deal.miles_to_depot))),
    cash: stripStats(ordered.map((row) => (signedIn ? row.deal.stated_cash_flow : null)), true),
    revenue: stripStats(ordered.map((row) => (signedIn ? row.deal.stated_revenue : null))),
    askingRevenue: stripStats(ordered.map((row) => (signedIn ? row.deal.revenue_multiple : null))),
    askingCash: stripStats(ordered.map((row) => (signedIn ? row.deal.earnings_multiple : null))),
    businessMultiple: stripStats(ordered.map((row) => (signedIn ? row.deal.business_multiple : null))),
    landEstimate: stripStats(ordered.map((row) => (signedIn ? row.deal.land_estimate : null))),
    county: stripStats(ordered.map((row) => (signedIn ? row.deal.county_value : null))),
    capacity: stripStats(ordered.map((row) => row.deal.cap_a_substation_mi)),
  }), [ordered, signedIn]);
  const visibleIds = ordered.map((row) => row.deal.deal_id);
  useEffect(() => { onScope?.(visibleIds, activeLayout); }, [visibleIds, activeLayout, onScope]);
  const pickedSet = new Set(picked.filter((id) => visibleIds.includes(id)));
  const pickedRows = ordered.filter((row) => pickedSet.has(row.deal.deal_id));
  const commonStage = sharedStage(ordered.map(row => stageChipLabel(row.deal.stage, row.deal.stage_group)));
  const allOn = visibleIds.length > 0 && visibleIds.every((id) => pickedSet.has(id));

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

  function commit(next: ListLayout) {
    update(next);
    const orderChanged = next.order.join(",") !== layout.order.join(",") || next.hidden.join(",") !== layout.hidden.join(",");
    const sortChanged = (next.sort?.id || "") !== (activeLayout.sort?.id || "") || Boolean(next.sort?.desc) !== Boolean(activeLayout.sort?.desc);
    if (orderChanged) onColumns(displayIds({ ...next, touched: true }, allowed, false, phoneColumns("pipeline")) as PipelineColumnId[]);
    if (sortChanged) onSort((next.sort?.id || "site") as PipelineColumnId, next.sort ? next.sort.desc : undefined);
  }

  function toggleColumn(id: PipelineColumnId) {
    if (id === "site") return;
    const hidden = activeLayout.hidden.includes(id)
      ? activeLayout.hidden.filter((item) => item !== id)
      : [...activeLayout.hidden, id];
    commit({ ...activeLayout, hidden, touched: true });
  }

  function toggleRow(id: string) {
    setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function toggleAll() {
    setPicked(allOn ? [] : visibleIds);
  }

  function download(target: PipelineRow[]) {
    const blob = new Blob([pipelineCsv(target, visible as PipelineColumnId[], signedIn)], { type: "text/csv" });
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
      const failed = await onComment(pickedRows.map((row) => row.deal.deal_id), note.trim());
      if (failed.length) {
        const saved = pickedRows.filter(row => !failed.includes(row.deal.deal_id));
        setPicked(failed);
        setActionError(`${saved.length} of ${pickedRows.length} saved.${saved.length ? " Saved: " + saved.map(row => row.deal.name || row.deal.deal_id).join(", ") + "." : ""} The remaining sites are selected for retry.`);
        return;
      }
      setCommentOpen(false);
      setNote("");
      setPicked([]);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The note could not be saved.");
    } finally {
      setPending(false);
    }
  }

  async function submitDrop() {
    const label = tagFamily("drop_reason")?.codes.find((item) => item.code === reason)?.label || "";
    if (!onDrop || !label || !pickedRows.length) return;
    setPending(true);
    setActionError("");
    try {
      const failed = await onDrop(pickedRows.map((row) => row.deal.deal_id), label);
      if (failed.length) {
        const saved = pickedRows.filter(row => !failed.includes(row.deal.deal_id));
        setPicked(failed);
        setActionError(`${saved.length} of ${pickedRows.length} saved.${saved.length ? " Saved: " + saved.map(row => row.deal.name || row.deal.deal_id).join(", ") + "." : ""} The remaining sites are selected for retry.`);
        return;
      }
      setDropOpen(false);
      setReason("");
      setPicked([]);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The drop could not be submitted.");
    } finally {
      setPending(false);
    }
  }

  const summaryBar = (
    <ShortlistSummary title={title} count={ordered.length} commonStage={commonStage}>
      <div><span className="only-desktop">Median asking</span><span className="only-mobile">Median asking</span><strong title={summary.medianAsking == null ? "Not on file" : undefined}>{summary.medianAsking == null ? "—" : fullMoney(summary.medianAsking)}</strong><small>{summary.withAsking} of {summary.count} reported</small></div>
      <div><span className="only-desktop">Land listed</span><span className="only-mobile">Land</span><strong>{summary.count === 0 ? "No matching sites" : summary.withAcres ? acresTotal(summary.totalAcres) : "Acreage unknown"}</strong>{summary.withAcres > 0 && <small>{summary.withAcres} of {summary.count} reported</small>}</div>
      <div><span className="only-desktop">Market land comps / acre</span><span className="only-mobile">Land comps / acre</span><strong title={signedIn ? compMedian.tip : "Signed out"}>{!signedIn || compMedian.value == null ? "—" : compactMoney(compMedian.value)}</strong>{signedIn && <details className="disclosure"><summary className="disclosure">Market basis</summary><p>{compMedian.tip}</p>{Array.from(marketComps, ([market, value]) => <p key={market}>{market} · {fullMoney(value)} per acre</p>)}</details>}</div>
    </ShortlistSummary>
  );
  const outside = outsideRow ? (
    <div className="outside-row" data-testid="outside-row">
      <p className="note">Outside this filter</p>
      <button type="button" className="list-row" onClick={() => onOpen(outsideRow.deal.deal_id)}>
        <span className="phone-card-name">{outsideRow.deal.name || outsideRow.deal.address || outsideRow.deal.deal_id}</span>
        {displayAddress(outsideRow.deal.address) ? <span className="site-address">{displayAddress(outsideRow.deal.address)}</span> : null}
      </button>
    </div>
  ) : null;

  return (
    <div ref={paneRef} className="list-pane pipeline-list" data-list-count={rows.length} data-testid="pipeline-list">
      {summaryBar}
      <div className="list-bar">
        {mapArea ? <p>Within map area</p> : null}
        {mapArea ? <button type="button" className="chip removable only-desktop" onClick={onClearArea}>Map area</button> : null}
        {Object.entries(activeLayout.filters).map(([id, value]) => {
          const label = PIPELINE_COLUMNS.find((column) => column.id === id)?.label || id;
          return (
            <button
              key={id}
              type="button"
              className="chip removable"
              onClick={() => {
                const filters = { ...activeLayout.filters };
                delete filters[id];
                commit({ ...activeLayout, filters, touched: true });
              }}
            >
              {label}
              <span> · {value}</span>
            </button>
          );
        })}
        {signedIn && <button className="paper-btn" type="button" aria-expanded={financeOpen} onClick={()=>setReviewFilter("finFilter",financeOpen ? "" : "1")}>Filter by financials</button>}
        {signedIn && financeOpen && <FinanceFilters deals={rows.map(r=>r.deal)} evidence={finEvidence} carry={finCarry} setEvidence={v=>setReviewFilter("finEvidence",v)} setCarry={v=>setReviewFilter("finCarry",v)}/>}
        <ColumnPicker
          resetLabel="Pipeline default"
          onPreset={signedIn ? () => {
            const preferred = ["site", "stage", "asking", "revenue", "cashFlow", "askingCash", "nextStep"].filter(id => allowed.includes(id));
            const rest = allowed.filter(id => !preferred.includes(id));
            commit({ ...activeLayout, order: [...preferred, ...rest], hidden: rest, touched: true });
          } : undefined}
          columns={PIPELINE_COLUMNS.filter((column) => allowed.includes(column.id)).map((column) => ({ id: column.id, label: column.label }))}
          hidden={activeLayout.hidden}
          onToggle={(id) => toggleColumn(id as PipelineColumnId)}
          onReset={() => { update(defaultLayout(allowed)); onResetColumns(); }}
        />
        <SortControl
          columns={visible.flatMap((id) => {
            const column = PIPELINE_COLUMNS.find((item) => item.id === id);
            return column ? [{ id: column.id, label: column.label }] : [];
          })}
          sort={{ id: activeLayout.sort?.id || "site", desc: Boolean(activeLayout.sort?.desc) }}
          onChange={(id, desc) => commit({ ...activeLayout, sort: { id, desc }, touched: true })}
        />
        {signedIn && <a className="paper-btn only-desktop" onClick={()=>rememberReviewPosition(listScroller(),"",picked)} href={reviewLink("/selection-review",{scope},origin)}>Screen pipeline</a>}
        {signedIn && <a className="paper-btn only-desktop" onClick={()=>rememberReviewPosition(listScroller(),"",picked)} href={reviewLink("/space-review",{scope},origin)}>Review layouts</a>}
        <button type="button" className="paper-btn only-desktop" onClick={() => download(ordered)}>Export CSV</button>
        <div className="more-wrap only-mobile">
          <button type="button" className="paper-btn" aria-expanded={moreOpen} aria-haspopup="menu" aria-label="More list actions" onClick={() => setMoreOpen((value) => !value)}>More</button>
          {moreOpen ? (
            <div className="menu" role="menu" aria-label="List actions">
              {signedIn && <a className="menu-item" role="menuitem" onClick={()=>rememberReviewPosition(listScroller(),"",picked)} href={reviewLink("/selection-review",{scope},origin)}>Screen pipeline</a>}
              {signedIn && <a className="menu-item" role="menuitem" onClick={()=>rememberReviewPosition(listScroller(),"",picked)} href={reviewLink("/space-review",{scope},origin)}>Review layouts</a>}
              {<button type="button" className="menu-item" role="menuitem" onClick={() => { toggleAll(); setMoreOpen(false); }}>{allOn ? "Clear selection" : "Select all shown"}</button>}
              <button type="button" className="menu-item" role="menuitem" onClick={() => { setMoreOpen(false); download(ordered); }}>Export CSV</button>
              {mapArea ? <button type="button" className="menu-item" role="menuitem" onClick={() => { setMoreOpen(false); onClearArea?.(); }}>Clear area</button> : null}
            </div>
          ) : null}
        </div>
      </div>
      {!ordered.length && <EmptyShortlist
        clearFilters={Object.values(activeLayout.filters).some(Boolean) ? ()=>commit({...activeLayout,filters:{},touched:true}) : undefined}
        clearArea={mapArea ? onClearArea : undefined} />}
      {phone ? (
        <div className="list-scroll">
          {outside}
          <PhoneCards commonStage={commonStage} rows={ordered.map((row) => {
            const id = row.deal.deal_id;
            const address = displayAddress(row.deal.address);
            return {
              id,
              name: String(cell(row, "site", signedIn)),
              address: address && address !== String(row.deal.name || "").trim() ? address : "",
              stage: stageChipLabel(row.deal.stage, row.deal.stage_group),
              stageNote: droppedDecisionLine(row.deal),
              tone: stageTone(row.deal),
              facts: phoneFacts(row, signedIn),
              actionLabel: signedIn ? row.deal.charging?.merit.action : undefined,
              action: signedIn ? row.deal.charging?.merit.next || plainNextStep(row.deal.next_step || "").line || undefined : undefined,
              chips: (() => {
                if (row.deal.kind === "land") return <LandPausedChip />;
                if (row.deal.next_step && signedIn) return null;
                const chips = dealChips(row.deal, signedIn);
                const priority = chips.find(chip => chip.family === "waiting_on" && chip.code !== "nothing") || chips.find(chip => chip.family === "biggest_gap");
                return priority ? <TagChip chip={priority} compact /> : null;
              })(),
              selected: id === selectedId,
              check: (
                <label className="row-check">
                  <input className="check" type="checkbox" aria-label={`Select ${row.deal.name || id}, ${displayAddress(row.deal.address) || id}`} checked={pickedSet.has(id)} onChange={() => toggleRow(id)} />
                </label>
              ),
              secondaryAction:signedIn && onFinancials && row.deal.kind==="pipeline" && <button type="button" className="text-link" onClick={()=>onFinancials(id)}>Financials</button>,
              onOpen: () => onOpen(id),
            };
          })} />
        </div>
      ) : null}
      {phone ? null : outside}
      {phone ? null : <SheetGrid
        rows={ordered}
        rowId={(row) => row.deal.deal_id}
        columns={sheetColumns}
        layout={activeLayout}
        onLayout={commit}
        selectedId={selectedId}
        onOpen={onOpen}
        onClose={() => onDismiss?.()}
        scrollRef={scrollRef}
        headerExtra={(id) => id === "site" ? (
          <RowCheck label="Select all shown" checked={allOn} onChange={toggleAll} />
        ) : null}
        renderCell={(row, column) => {
          const id = row.deal.deal_id;
          if (column === "openLand") return <NumberCell label={cell(row, "openLand", signedIn)} value={openLandMeasured(row.deal.open_land_sqft, row.deal.open_land_basis) ? row.deal.open_land_sqft : null} stats={strips.openLand} direction="higher" format={openLandText} />;
          if (column === "asking") return <AskingCell deal={row.deal} stats={strips.asking} onBroker={onBroker} signedIn={signedIn} />;
          if (column === "acres") return <NumberCell label={cell(row, "acres", signedIn)} value={row.deal.land_acres} stats={strips.acres} format={(value) => acresText(value) || String(value)} />;
          if (column === "perAcre") return <NumberCell label={cell(row, "perAcre", signedIn)} value={signedIn ? row.deal.price_per_acre : null} stats={strips.perAcre} direction="lower" format={fullMoney} />;
          if (column === "traffic") return <NumberCell label={cell(row, "traffic", signedIn)} value={row.deal.trade_aadt} stats={strips.traffic} direction="higher" format={countText} />;
          if (column === "depot") return row.noPin ? <span className="no-pin">No pin</span> : <NumberCell label={cell(row, "depot", signedIn)} value={row.deal.miles_to_depot} stats={strips.depot} direction="lower" format={mileText} />;
          if (column === "cashFlow") {
            if (signedIn && isQuickLube(row.deal.business_type)) return <NumberCell label="N/A" labelTitle="Wash cash flow does not apply." value={null} stats={strips.cash} direction="higher" format={fullMoney} />;
            if (!signedIn || cashTile(row.deal).hidden) return <span>{signedIn ? "" : "—"}</span>;
            const cashLabel = cashFlowListLabel(row.deal);
            return <NumberCell label={cashLabel.text} labelTitle={cashLabel.title} value={row.deal.stated_cash_flow} stats={strips.cash} direction="higher" markNegative format={fullMoney} />;
          }
          if (column === "revenue") return <NumberCell label={cell(row, "revenue", signedIn)} badge={signedIn && row.deal.stated_revenue != null ? basisBadge(row.deal.revenue_basis) : ""} value={signedIn ? row.deal.stated_revenue : null} stats={strips.revenue} direction="higher" format={fullMoney} labelTitle={row.deal.revenue_period || undefined} />;
          if (column === "askingRevenue") return <NumberCell label={cell(row, "askingRevenue", signedIn)} badge={signedIn && row.deal.revenue_multiple != null ? basisBadge(row.deal.revenue_multiple_basis) : ""} value={signedIn ? row.deal.revenue_multiple : null} stats={strips.askingRevenue} direction="lower" format={multipleText} labelTitle={row.deal.revenue_multiple_basis || undefined} />;
          if (column === "askingCash") return <NumberCell label={cell(row, "askingCash", signedIn)} badge={signedIn && row.deal.earnings_multiple != null ? basisBadge(row.deal.earnings_multiple_basis) : ""} value={signedIn ? row.deal.earnings_multiple : null} stats={strips.askingCash} direction="lower" format={multipleText} labelTitle={[row.deal.earnings_multiple_which ? `Asking / ${row.deal.earnings_multiple_which}` : "", row.deal.earnings_multiple_basis].filter(Boolean).join(" · ") || undefined} />;
          if (column === "businessMultiple") return <NumberCell label={cell(row, "businessMultiple", signedIn)} badge={signedIn && row.deal.business_multiple != null ? basisBadge(row.deal.business_multiple_basis) : ""} value={signedIn ? row.deal.business_multiple : null} stats={strips.businessMultiple} direction="lower" format={multipleText} labelTitle={row.deal.business_multiple != null ? "Asking minus the land estimate, divided by cash flow or EBITDA." : (row.deal.business_multiple_reason || undefined)} />;
          if (column === "landEstimate") return <NumberCell label={cell(row, "landEstimate", signedIn)} value={signedIn ? row.deal.land_estimate : null} stats={strips.landEstimate} format={fullMoney} labelTitle={row.deal.land_estimate_tip || row.deal.land_estimate_reason || undefined} />;
          if (column === "countyValue") return <NumberCell label={cell(row, "countyValue", signedIn)} badge={signedIn && row.deal.county_value != null ? "County" : ""} value={signedIn ? row.deal.county_value : null} stats={strips.county} format={fullMoney} labelTitle={row.deal.county_value_basis || undefined} />;
          if (column === "capacity") return <NumberCell label={cell(row, "capacity", signedIn)} value={row.deal.cap_a_substation_mi} stats={strips.capacity} direction="lower" format={mileText} labelTitle={capacitySummary(factsForDeal(row.deal)) || "Not on file"} />;
          const family = columnFamily(column);
          if (family) {
            const chip = dealChips(row.deal, signedIn).find((item) => item.family === family.family);
            if (chip && (signedIn || !family.signedIn)) return <TagChip chip={chip} compact />;
            if (column !== "nda") return "—";
          }
          if (column === "score") return <ScoreCell input={scoreInput(row)} />;
          if (column === "county") return row.countyLabel ? <CountyChip label={row.countyLabel} note={row.countyNote || ""} /> : "—";
          if (column === "type") return <span className="stage-cell"><TypeChip value={typeLabel(row.deal)} />{row.deal.kind === "land" ? <LandPausedChip /> : null}</span>;
          if (column === "stage") {
            const nda = signedIn ? dealChips(row.deal, signedIn).find((chip) => chip.family === "nda" && chip.code !== "not_required") : undefined;
            return (
              <StageTypeCell
            hideStage={Boolean(commonStage)}
                stage={row.deal.stage || ""}
                group={row.deal.stage_group || ""}
                detail={droppedDecisionLine(row.deal)}
                type={typeLabel(row.deal)}
                land={row.deal.kind === "land"}
                extra={<>
                  {nda ? <TagChip chip={nda} compact /> : null}
                  <StagePending note={row.deal.stage_pending} />
                </>}
              />
            );
          }
          if (column === "site") return (
            <span className="site-name">
              {(
                <RowCheck label={`Select ${row.deal.name || id}, ${displayAddress(row.deal.address) || id}`} checked={pickedSet.has(id)} onChange={() => toggleRow(id)} />
              )}
              <span className="site-title">
                <span className="site-name-text" title={String(cell(row, "site", signedIn) || row.deal.deal_id)}>
                  {unread.has(row.deal.deal_id) ? <i className="queue-dot" data-testid="queue-dot" aria-label="In your review" /> : null}
                  {cell(row, "site", signedIn)}
                  {row.noPin ? <span className="no-pin"> No pin</span> : null}
                </span>
                {signedIn && onFinancials && row.deal.kind==="pipeline" && <button type="button" className="text-link" onClick={e=>{e.stopPropagation();onFinancials(id);}}>Financials</button>}
                <span className="site-meta">
                  {displayAddress(row.deal.address) && displayAddress(row.deal.address) !== String(row.deal.name || "").trim() ? (
                    <span className="site-address" title={displayAddress(row.deal.address)}>{displayAddress(row.deal.address)}</span>
                  ) : <span className="site-address" />}
                  <NearMark deal={row.deal} />
                  {signedIn ? (() => {
                    const drop = dealChips(row.deal, signedIn).find((chip) => chip.family === "drop_reason") || suggestedDropChip(String(row.deal.suggested_drop || ""));
                    if (!drop) return null;
                    return <span data-testid={drop.source === "suggested_drop" ? "suggested-drop" : undefined}><TagChip chip={drop} compact /></span>;
                  })() : null}
                </span>
              </span>
              <RowLinks listing={listingHref(row.deal.listing_url)} folder={folderHref(row.deal.folder_url)} packageHref={row.deal.package_href} />
            </span>
          );
          return cell(row, column as PipelineColumnId, signedIn);
        }}
        flexIds={["site", "asking", "capacity", "traffic", "cashFlow"]}
        wrapIds={["site", "stage", "asking", "cashFlow"]}
        trailing={(row) => (
          <button type="button" className={row.noPin ? "text-link no-pin" : "text-link"} onClick={(event) => { event.stopPropagation(); onShowMap(row.deal.deal_id); }}>{row.noPin ? "No pin" : "Show on map"}</button>
        )}
      />}
      {pickedRows.length ? (
        <div className="selection-bar" data-testid="selection-bar" ref={barRef}>
          <p>{pickedRows.length.toLocaleString()} selected{pickedRows.length < 2 ? " · Select one more to compare" : pickedRows.length > 4 ? " · Choose up to 4 to compare" : ""}</p>
          <button type="button" className="paper-btn" disabled={pickedRows.length < 2 || pickedRows.length > 4} title="Opens the compare view for 2 to 4 sites" onClick={() => onCompare?.(pickedRows.map((row) => row.deal.deal_id))}>Compare</button>
          <button type="button" className="paper-btn" onClick={() => download(pickedRows)}>Export CSV</button>
          <button type="button" className="paper-btn" onClick={() => { void Promise.resolve(onCopyLink?.(pickedRows.map((row) => row.deal.deal_id))).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }); }}>{copied ? "Link copied" : "Copy link"}</button>
          {canAct && onComment ? <button type="button" className="paper-btn" onClick={() => { setActionError(""); setCommentOpen(true); }}>Comment</button> : null}
          {canAct && onDrop ? <button type="button" className="paper-btn" onClick={() => { setActionError(""); setDropOpen(true); }}>Propose drop</button> : null}
        </div>
      ) : null}
      {commentOpen ? createPortal(
        <div className="list-dialog">
          <div className="popover" role="dialog" aria-label="Comment">
            <div className="popover-head">
              <h2>Comment</h2>
              <button type="button" className="close" aria-label="Close comment" onClick={() => setCommentOpen(false)}><span aria-hidden="true">×</span></button>
            </div>
            <p className="filter-note">One note is added to each selected site, on the same note path as a single comment.</p>
            <ul className="pick-list">{pickedRows.map((row) => <li key={row.deal.deal_id}>{row.deal.name || row.deal.deal_id} · {displayAddress(row.deal.address) || row.deal.deal_id}</li>)}</ul>
            <label>
              Note
              <textarea className="field" aria-label="Note" value={note} rows={3} maxLength={4000} onChange={(event) => setNote(event.target.value)} />
            </label>
            {actionError ? <p className="err">{actionError}</p> : null}
            <button type="button" className="primary" disabled={pending || !note.trim()} onClick={() => void submitComment()}>Add note</button>
          </div>
        </div>,
        document.body,
      ) : null}
      {dropOpen ? createPortal(
        <div className="list-dialog">
          <div className="popover" role="dialog" aria-label="Propose drop">
            <div className="popover-head">
              <h2>Propose drop</h2>
              <button type="button" className="close" aria-label="Close drop" onClick={() => setDropOpen(false)}><span aria-hidden="true">×</span></button>
            </div>
            <p className="filter-note">Each site is submitted for approval with this reason. Nothing is dropped until someone approves it.</p>
            <ul className="pick-list">{pickedRows.map((row) => <li key={row.deal.deal_id}>{row.deal.name || row.deal.deal_id} · {displayAddress(row.deal.address) || row.deal.deal_id}</li>)}</ul>
            <ReasonPicker label="Drop reason" testId="drop-reason" options={tagFamily("drop_reason")?.codes || []} value={reason} onChange={setReason} />
            {actionError ? <p className="err">{actionError}</p> : null}
            <button type="button" className="primary" disabled={pending || !tagFamily("drop_reason")?.codes.some((item) => item.code === reason)} onClick={() => void submitDrop()}>Submit for approval</button>
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

function NearMark({ deal }: { deal: DealProps }) {
  const label = serviceAreaChip(deal);
  if (!label || deal.service_area_class === "outside") return null;
  if (deal.service_area_class !== "near_0_5" && deal.service_area_class !== "near_5_10") return null;
  return <span className="badge quiet near-chip" data-testid="near-chip" data-short={serviceAreaShort(deal)} title={NEAR_TIP}>{label}</span>;
}

function countText(value: number) {
  return Math.round(value).toLocaleString("en-US");
}

function mileText(value: number) {
  const text = value.toFixed(2).replace(/\.?0+$/, "");
  return `${text} mi`;
}

function multipleText(value: number) {
  return `${value.toFixed(1)}x`;
}

function Strip({
  value,
  stats,
  direction = "neutral",
  markNegative = false,
  format,
}: {
  value?: number | null;
  stats: StripStats | null;
  direction?: StripDirection;
  markNegative?: boolean;
  format: (value: number) => string;
}) {
  if (value == null || !Number.isFinite(value) || !stats) return null;
  const place = stripPlace(value, stats, direction, markNegative);
  if (place.count === 1) return <small className="layer-meta">Only reported figure</small>;
  return (
    <span className="range-strip" title={stripTip(format(value), format(stats.median), place.rank, place.count)}>
      <i className="range-track" />
      {place.zeroLeft != null ? <i className="range-zero" style={{ left: `${place.zeroLeft}%` }} /> : null}
      <i className="range-median" style={{ left: `${place.medianLeft}%` }} />
      <i className={`range-dot tone-${place.tone}`} style={{ left: `${place.left}%` }} />
    </span>
  );
}

function NumberCell({
  label,
  badge,
  value,
  stats,
  direction = "neutral",
  markNegative = false,
  format,
  labelTitle,
}: {
  label: string;
  badge?: string;
  value?: number | null;
  stats: StripStats | null;
  direction?: StripDirection;
  markNegative?: boolean;
  format: (value: number) => string;
  labelTitle?: string;
}) {
  return (
    <span className="metric">
      <span className="metric-label" title={labelTitle || label}>
        {label || "—"}
        {badge ? <em className="list-basis">{badge}</em> : null}
      </span>
      <Strip value={value} stats={stats} direction={direction} markNegative={markNegative} format={format} />
    </span>
  );
}

function AskingCell({ deal, stats, onBroker, signedIn }: { deal: DealProps; stats: StripStats | null; onBroker?: (name: string) => void; signedIn: boolean }) {
  if (!signedIn) return <span>—</span>;
  const price = deal.asking_price_display;
  if (!price) return <span title="Not on file">—</span>;
  const source = shownPriceSource(deal);
  const listing = listingHref(deal.listing_url);
  const party = shownBroker(deal) || shownFirm(deal);
  const full = source ? `${price} · ${source}` : price;
  const sourceNode = !source ? null : listing ? (
    <a className="text-link" href={listing} target="_blank" rel="noopener noreferrer" title={`${full}. Opens the listing`} onClick={(event) => event.stopPropagation()}>{source} · Open listing ↗</a>
  ) : party && onBroker ? (
    <button type="button" className="text-link" title={`${full}. Filters the list to this broker`} onClick={(event) => { event.stopPropagation(); onBroker(party); }}>See {source} sites · All markets</button>
  ) : (
    source
  );
  return (
    <span className="metric">
      <span className="metric-label" title={full}>{price}{sourceNode ? <> · {sourceNode}</> : null}</span>
      <Strip value={deal.asking_price} stats={stats} format={fullMoney} />
    </span>
  );
}
