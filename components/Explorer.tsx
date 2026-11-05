"use client";

import dynamic from "next/dynamic";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ActionsDialogs, ActionsMenuButtons } from "./actions/ActionsChrome";
import { QueueBar, QueueControls, QueueEmpty, type QueueItem } from "./queue/QueueView";
import { RecordActions } from "./actions/RecordActions";
import Detail, { DealDetail, UnscreenedDetail } from "./Detail";
import Wordmark from "./Wordmark";
import ListView, { LIST_COLUMNS, listCsv, type ListRow } from "./ListView";
import SiteTable, { DealTable, siteExportHeaders, siteExportRow, type ActivitySummary } from "./SiteTable";
import { DRAWER_DEFAULT, DRAWER_WIDTH_KEY, clampDrawerWidth } from "@/lib/drawerWidth";
import { CITY_VIEW, CITIES, compareSites, droppedAt, heldOutside, inStage, nearestDepot, presentSite, type PipeId, type StageId } from "@/lib/filter";
import { leadSourceLine, plainRoad, shownBroker, shownFirm, shownPriceSource } from "@/lib/format";
import { AREA_KIND_LABEL, AREA_NOTES, BUSINESS_TYPES, CENSUS_NOTE, FUNNEL_NOTES, STATUS_NOTES, SUMMARY_NOTES, TIER_NOTES, plainVerdict, stageDetail, stageTitle, tierLabel } from "@/lib/labels";
import type { AppData, DealFeature, DealProps, SiteFeature, SiteProps, UnscreenedFeature, UnscreenedProps } from "@/lib/types";

const MapView = dynamic(() => import("./MapView"), { ssr: false });

const PIPE_STEPS: { id: PipeId; label: string }[] = [
  { id: "desk", label: "Desk screen" },
  { id: "financial", label: "Financial screen" },
  { id: "checks", label: "Site checks" },
  { id: "close", label: "Offer and close" },
  { id: "dropped", label: "Dropped" },
];

const STEPS: { id: StageId; label: string }[] = [
  { id: "universe", label: "Universe" },
  { id: "in_area", label: "In service area" },
  { id: "land", label: "Spare land" },
  { id: "county", label: "County-checked" },
  { id: "cleared", label: "Cleared" },
];

export default function Explorer() {
  const params = useSearchParams();
  const router = useRouter();
  const shellRef = useRef<HTMLDivElement>(null);
  const applyDrawerWidth = useCallback(() => {
    const node = shellRef.current;
    if (!node) return;
    const stored = Number(localStorage.getItem(DRAWER_WIDTH_KEY));
    const width = Number.isFinite(stored) && stored > 0
      ? clampDrawerWidth(stored, window.innerWidth)
      : DRAWER_DEFAULT;
    node.style.setProperty("--drawer-width", `${width}px`);
    node.dataset.drawerWidth = String(width);
  }, []);
  const bindShell = useCallback((node: HTMLDivElement | null) => {
    shellRef.current = node;
    applyDrawerWidth();
  }, [applyDrawerWidth]);
  useEffect(() => {
    window.addEventListener("resize", applyDrawerWidth);
    return () => window.removeEventListener("resize", applyDrawerWidth);
  }, [applyDrawerWidth]);
  const [data, setData] = useState<AppData | null>(null);
  const [activity, setActivity] = useState<ActivitySummary>({});
  const [unscreened, setUnscreened] = useState<UnscreenedFeature[]>([]);
  const [detail, setDetail] = useState<SiteProps | null>(null);
  const [me, setMe] = useState<{ u: string; role: string; actionsEnabled?: boolean } | null>(null);
  const [queueCount, setQueueCount] = useState(0);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [queueFirst, setQueueFirst] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(params.get("site"));
  const tableOpen = params.get("table") === "1";
  const compare = params.get("disagree") === "1";
  const showDropped = params.get("ruled") === "1";
  const [layersOpen, setLayersOpen] = useState(false);
  const showAreas = params.get("areas") !== "0";
  const showDepots = params.get("depots") !== "0";
  const showUniverse = params.get("pins") !== "0";
  const showPipeline = params.get("deals") !== "0";
  const showUnscreened = params.get("newlist") === "1";
  const showDroppedDeals = params.get("dropped") === "1";
  const showRings = params.get("rings") === "1";
  const typesParam = params.get("types");
  const businessTypes = typesParam ? typesParam.split("|").filter(Boolean) : null;
  const tabParam = params.get("tab");
  const tableTab: "universe" | "pipeline" | "land" = tabParam === "pipeline" || tabParam === "land" ? tabParam : "universe";
  const [tip, setTip] = useState("");
  const [copied, setCopied] = useState(false);
  const compareIds = (params.get("compare") || "").split("|").filter(Boolean).slice(0, 4);
  const [changesNote, setChangesNote] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [unplacedOpen, setUnplacedOpen] = useState(false);
  const [withheldOpen, setWithheldOpen] = useState(false);

  const city = params.get("city") || "PHX";
  const stageParam = params.get("stage") as StageId | null;
  const stage: StageId = stageParam && STEPS.some((step) => step.id === stageParam) ? stageParam : "land";
  const landTier = params.get("tier") || "any";
  const verdict = params.get("verdict") || "any";
  const listed = params.get("listed") || "any";
  const landSites = params.get("land") === "1";
  const query = params.get("q") || "";
  const funnel = params.get("funnel") === "pipeline" ? "pipeline" : "universe";
  const showLandLayer = funnel === "pipeline" ? params.get("landlayer") !== "0" : params.get("landlayer") === "1";
  const extraParam = params.get("extra");
  const extra = extraParam === "listed" || extraParam === "contacted" || extraParam === "held" ? extraParam : null;
  const pipeParam = params.get("pstage") as PipeId | null;
  const pipeStage: PipeId = pipeParam && PIPE_STEPS.some((step) => step.id === pipeParam) ? pipeParam : "desk";
  const listView = params.get("view") === "list";
  const sortParam = params.get("sort") || "site:asc";
  const sortKey = (LIST_COLUMNS.some((column) => column.id === sortParam.split(":")[0]) ? sortParam.split(":")[0] : "site") as keyof Omit<ListRow, "id">;
  const sortDesc = sortParam.endsWith(":desc");
  const queueOpen = params.get("view") === "queue";
  const queueMarket = params.get("qmarket") || city;
  const queueStage = params.get("qstage") || (funnel === "pipeline" ? pipeStage : "any");
  const queueViable = params.get("qviable") !== "0";
  const queueFresh = params.get("qnew") === "1";
  const queueFlagged = params.get("qflag") === "1";
  const queueApproval = params.get("qapprove") === "1";
  const queueMentions = params.get("qmention") === "1";
  const queueAssigned = params.get("qassign") === "1";
  const [queueTick, setQueueTick] = useState(0);

  function write(next: Record<string, string | null>, history = false) {
    const url = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (!value) url.delete(key);
      else url.set(key, value);
    }
    const href = `/?${url.toString()}`;
    if (history) router.push(href, { scroll: false });
    else router.replace(href, { scroll: false });
  }

  function setTableTab(tab: "universe" | "pipeline" | "land") {
    write({ tab: tab === "universe" ? null : tab });
  }

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  useEffect(() => {
    let cancel = false;
    Promise.all([
      fetch(`/api/data/sites?city=${city}`),
      fetch("/api/data/areas"),
      fetch("/api/data/depots"),
      fetch(`/api/data/parcels?city=${city}`),
      fetch("/api/data/funnel"),
      fetch("/api/data/deals"),
      fetch("/api/data/unscreened"),
      fetch("/api/data/timeline/summary"),
      fetch("/api/me"),
    ]).then(async ([sitesRes, areasRes, depotsRes, parcelsRes, funnelRes, dealsRes, unscreenedRes, summaryRes, meRes]) => {
      if (sitesRes.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!sitesRes.ok || !areasRes.ok || !depotsRes.ok || !parcelsRes.ok || !funnelRes.ok || !dealsRes.ok || !unscreenedRes.ok) {
        setError("The site data could not be loaded.");
        return;
      }
      const funnelPayload = await funnelRes.json();
      if (!cancel) {
        setData({
          sites: await sitesRes.json(),
          areas: await areasRes.json(),
          depots: await depotsRes.json(),
          parcels: await parcelsRes.json(),
          deals: await dealsRes.json(),
          funnel: funnelPayload.funnel,
        });
        const unscreenedPayload = await unscreenedRes.json();
        setUnscreened(Array.isArray(unscreenedPayload.features) ? unscreenedPayload.features : []);
        setMe(meRes.ok ? await meRes.json() : null);
        if (summaryRes.ok) {
          const summary = (await summaryRes.json()) as { records?: ActivitySummary };
          setActivity(summary.records || {});
        }
        const changes = funnelPayload.meta?.changes;
        if (changes && typeof changes.new_sites === "number") {
          setChangesNote(`Since the previous published build: ${changes.new_sites} new sites, ${changes.verdict_changes} verdict changes, ${changes.stage_moves} stage moves.`);
        }
      }
    });
    return () => {
      cancel = true;
    };
  }, [city]);

  useEffect(() => {
    const onRefresh = () => setQueueTick((value) => value + 1);
    window.addEventListener("queue-refresh", onRefresh);
    return () => window.removeEventListener("queue-refresh", onRefresh);
  }, []);

  useEffect(() => {
    if (!me?.actionsEnabled) return;
    const q = new URLSearchParams({
      market: queueMarket,
      stage: queueStage,
      viable: queueViable ? "1" : "0",
      fresh: queueFresh ? "1" : "0",
      flagged: queueFlagged ? "1" : "0",
      approve: queueApproval ? "1" : "0",
      mentions: queueMentions ? "1" : "0",
      assigned: queueAssigned ? "1" : "0",
    });
    let cancel = false;
    fetch(`/api/queue?${q}`).then(async (response) => {
      if (cancel || !response.ok) return;
      const payload = (await response.json()) as { firstTime?: boolean; items?: QueueItem[] };
      const next = payload.items || [];
      setQueueItems(next);
      setQueueCount(next.length);
      setQueueFirst(Boolean(payload.firstTime));
      setQueueIndex((current) => Math.min(current, Math.max(next.length - 1, 0)));
    }).catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [me?.actionsEnabled, queueMarket, queueStage, queueViable, queueFresh, queueFlagged, queueApproval, queueMentions, queueAssigned, queueTick]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1100px)");
    const apply = () => setLayersOpen(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    setSheetExpanded(false);
  }, [selected]);

  useEffect(() => {
    setSelected(params.get("site"));
  }, [params]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setFiltersOpen(false);
      setMoreOpen(false);
      setUserOpen(false);
      setMenuOpen(false);
      setUnplacedOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const features = data?.sites.features ?? [];
  const featureById = useMemo(() => {
    const map = new Map<string, SiteFeature>();
    for (const feature of features) map.set(feature.properties.site_id, feature);
    return map;
  }, [features]);
  const censusFeatures = features.filter((feature) => feature.properties.origin !== "off-market");
  const sites = censusFeatures.map((feature) => presentSite(feature.properties));
  const offMarketFeatures = features.filter((feature) => feature.properties.origin === "off-market" && feature.properties.city === city);

  function passesChips(site: SiteProps, loose: boolean) {
    if (site.city !== city) return false;
    if (query) {
      const blob = `${site.site_id} ${site.name} ${site.also_known_as || ""} ${site.address} ${site.apn} ${site.owner}`.toLowerCase();
      if (!blob.includes(query.toLowerCase())) return false;
    }
    if (loose) return true;
    if (landTier !== "any" && site.land_tier !== landTier) return false;
    if (verdict !== "any" && (site.verdict || "none") !== verdict) return false;
    if (listed === "yes" && !site.listed) return false;
    if (!typeOn(site.business_type || "Car wash")) return false;
    return true;
  }

  function typeOn(type: string) {
    return businessTypes === null || businessTypes.includes(type);
  }

  function setBusinessTypes(next: string[] | null) {
    write({ types: next && next.length ? next.join("|") : null });
  }

  function toggleType(type: string) {
    if (businessTypes === null) {
      setBusinessTypes(BUSINESS_TYPES.filter((item) => item !== type));
      return;
    }
    const next = businessTypes.includes(type)
      ? businessTypes.filter((item) => item !== type)
      : [...businessTypes, type];
    setBusinessTypes(next.length === 0 || next.length === BUSINESS_TYPES.length ? null : next);
  }

  useEffect(() => {
    setTip("");
  }, [funnel, city, stage]);

  const visibleSites = useMemo(() => {
    const byId = new Map<string, SiteProps>();
    const add = (list: SiteProps[]) => {
      for (const site of list) byId.set(site.site_id, site);
    };
    if (compare) {
      add(sites.filter((site) => site.verdict_disagreement && passesChips(site, true)));
    } else if (extra === "held") {
      add(sites.filter((site) => heldOutside(site) && passesChips(site, true)));
    } else if (extra === "listed") {
      add(sites.filter((site) => site.city === city && inStage(site, stage) && site.listed && passesChips(site, true)));
    } else if (extra === "contacted") {
      add(sites.filter((site) => site.city === city && inStage(site, stage) && site.contacted && passesChips(site, true)));
    } else {
      add(sites.filter((site) => inStage(site, stage) && passesChips(site, false)));
      if (showDropped) add(sites.filter((site) => droppedAt(site, stage) && passesChips(site, true)));
      if (landSites) add(sites.filter((site) => site.land_only && passesChips(site, true)));
    }
    return [...byId.values()].sort(compareSites);
    // passesChips closes over the chip state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, stage, city, landTier, verdict, listed, landSites, showDropped, compare, query, extra, businessTypes]);

  const visibleFeatures: SiteFeature[] = visibleSites.flatMap((site) => {
    const feature = featureById.get(site.site_id);
    if (!feature) return [];
    return [{ ...feature, properties: site }];
  });

  const dealFeatures = data?.deals.features ?? [];
  const dealRows = dealFeatures.map((feature) => feature.properties);

  function dealMatches(deal: DealProps) {
    if (deal.city !== city) return false;
    if (query) {
      const blob = `${deal.deal_id} ${deal.name} ${deal.address} ${deal.broker} ${deal.firm} ${deal.universe_id}`.toLowerCase();
      if (!blob.includes(query.toLowerCase())) return false;
    }
    if (funnel === "pipeline" && deal.kind === "pipeline" && deal.stage_group !== pipeStage) return false;
    if (!typeOn(deal.business_type || "Other")) return false;
    return true;
  }

  const pipelineDeals = dealRows.filter((deal) => deal.kind === "pipeline" && dealMatches(deal) && (deal.stage_group !== "dropped" || showDroppedDeals || (funnel === "pipeline" && pipeStage === "dropped")));
  const landDeals = dealRows.filter((deal) => deal.kind === "land" && deal.city === city && typeOn(deal.business_type || "Other") && (!query || `${deal.name} ${deal.address}`.toLowerCase().includes(query.toLowerCase())));

  function activityCells(id: string | undefined) {
    const touch = id ? activity[id] : undefined;
    return [touch?.lastTouched || "", touch?.materials || 0];
  }

  function exportTable() {
    const filterLine = `Filters: city ${city}, ${funnel === "pipeline" ? `pipeline ${pipeStage}` : `step ${stage}`}${query ? `, search ${query}` : ""}${landTier !== "any" ? `, tier ${landTier}` : ""}${verdict !== "any" ? `, verdict ${verdict}` : ""}${listed === "yes" ? ", listed" : ""}${businessTypes ? `, types ${businessTypes.join(" ")}` : ""}. As of ${new Date().toISOString().slice(0, 10)}.`;
    const headers = tableTab === "universe"
      ? [...siteExportHeaders(), "Last touched", "Materials"]
      : ["Deal", "Name", "City", "Stage", "Firm", "Broker", "Asking", "Asking source", "Depot mi", "Universe site", "Last touched", "Materials"];
    const body = tableTab === "universe"
      ? visibleSites.map((row) => [...siteExportRow(row), ...activityCells(row.linked_deal_id)])
      : (tableTab === "land" ? landDeals : pipelineDeals).map((row) => [
          row.deal_id, row.name, row.city, stageDetail(row.stage, row.stage_group), shownFirm(row), shownBroker(row), row.asking_price_display, shownPriceSource(row), row.miles_to_depot, row.universe_id, ...activityCells(row.deal_id),
        ]);
    const lines = [`# ${filterLine}`, headers.join(","), ...body.map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, "\"\"")}"`).join(","))];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${city}-${tableTab}.csv`;
    link.click();
    setMoreOpen(false);
    setMenuOpen(false);
    if (me?.actionsEnabled) {
      void fetch("/api/actions/exports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "table" }),
      }).catch(() => undefined);
    }
  }

  function addCompare(id: string) {
    const next = compareIds.includes(id) ? compareIds.filter((item) => item !== id) : compareIds.length >= 4 ? compareIds : [...compareIds, id];
    write({ compare: next.length ? next.join("|") : null });
  }

  function dealPoint(deal: DealProps): [number, number] | null {
    if (deal.universe_id) {
      const site = featureById.get(deal.universe_id);
      const coords = site?.geometry?.coordinates;
      if (coords) return [coords[0], coords[1]];
    }
    const feature = dealFeatures.find((item) => item.properties.deal_id === deal.deal_id);
    const coords = feature?.geometry?.coordinates;
    return coords ? [coords[0], coords[1]] : null;
  }

  function asSquare(deal: DealProps): DealFeature | null {
    const feature = dealFeatures.find((item) => item.properties.deal_id === deal.deal_id);
    const point = dealPoint(deal);
    if (!feature || !point) return null;
    return { ...feature, geometry: { type: "Point", coordinates: point } };
  }

  const pipelineStepRows = dealRows.filter((deal) => {
    if (deal.kind !== "pipeline" || deal.city !== city || deal.stage_group !== pipeStage) return false;
    if (!typeOn(deal.business_type || "Other")) return false;
    if (!query) return true;
    const blob = `${deal.deal_id} ${deal.name} ${deal.address} ${deal.broker} ${deal.firm} ${deal.universe_id}`.toLowerCase();
    return blob.includes(query.toLowerCase());
  });
  const pipelineSquares = pipelineStepRows.map(asSquare).filter((feature): feature is DealFeature => Boolean(feature));
  const stageLandRows = landDeals.filter((deal) => funnel !== "pipeline" || deal.stage_group === pipeStage);
  const stageLandSquares = stageLandRows.map(asSquare).filter((feature): feature is DealFeature => Boolean(feature));
  const drawnDeals: DealFeature[] = funnel === "pipeline"
    ? [
        ...(showPipeline ? pipelineSquares : []),
        ...(showLandLayer ? stageLandSquares : []),
      ]
    : [
        ...(showPipeline ? pipelineDeals.filter((deal) => !deal.universe_id) : []),
        ...(showLandLayer ? landDeals : []),
      ]
        .map((deal) => dealFeatures.find((feature) => feature.properties.deal_id === deal.deal_id))
        .filter((feature): feature is DealFeature => Boolean(feature?.geometry));
  const linkedIds = new Set(pipelineSquares.map((feature) => feature.properties.universe_id).filter(Boolean));
  const pipelineSites = features.flatMap((feature) => {
    if (!linkedIds.has(feature.properties.site_id) || !feature.geometry) return [];
    return [{ ...feature, properties: presentSite(feature.properties) }];
  });

  const selectedSite = detail && detail.site_id === selected
    ? detail
    : sites.find((site) => site.site_id === selected)
      ?? offMarketFeatures.find((feature) => feature.properties.site_id === selected)?.properties
      ?? null;
  const selectedDeal = dealRows.find((deal) => deal.deal_id === selected) ?? null;
  const selectedUnscreened = unscreened.find((feature) => feature.properties.listing_id === selected)?.properties ?? null;
  const withheldHere = showUnscreened ? unscreened.filter((feature) => feature.properties.city === city && !feature.properties.pinned) : [];

  useEffect(() => {
    if (!selected) return;
    let cancel = false;
    fetch(`/api/data/sites/${encodeURIComponent(selected)}`).then(async (response) => {
      if (!response.ok) return;
      const payload = presentSite((await response.json()) as SiteProps);
      if (!cancel) setDetail(payload);
    });
    return () => {
      cancel = true;
    };
  }, [selected]);

  function choose(id: string | null) {
    setSelected(id);
    write({ site: id }, true);
  }

  function jump(nextCity: string) {
    setSelected(null);
    write({ city: nextCity === "PHX" ? null : nextCity, site: null }, true);
  }

  function filtersOn() {
    return Boolean(query || businessTypes || landTier !== "any" || verdict !== "any" || listed === "yes" || landSites || compare || showDropped);
  }

  function count(step: StageId) {
    return sites.filter((site) => site.city === city && inStage(site, step)).length;
  }

  function filteredAt(step: StageId) {
    if (compare) return sites.filter((site) => site.city === city && site.verdict_disagreement && passesChips(site, true) && inStage(site, step)).length;
    let total = sites.filter((site) => inStage(site, step) && passesChips(site, false)).length;
    if (landSites) total += sites.filter((site) => site.land_only && site.city === city && passesChips(site, true)).length;
    if (showDropped) total += sites.filter((site) => droppedAt(site, step) && passesChips(site, true)).length;
    return total;
  }

  function stepBadge(step: StageId) {
    const total = count(step);
    if (!filtersOn()) return total.toLocaleString();
    const shown = step === stage && extra == null ? visibleSites.length : filteredAt(step);
    return `${shown.toLocaleString()} of ${total.toLocaleString()}`;
  }

  function subcount(step: StageId, field: "listed" | "contacted") {
    return sites.filter((site) => site.city === city && inStage(site, step) && site[field] && passesChips(site, false)).length;
  }

  const heldCount = sites.filter((site) => site.city === city && heldOutside(site)).length;
  const censusForCity = data?.funnel.stages.find((item) => item.id === "census")?.by_city?.[city] ?? 0;

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const queueSiteId = queueOpen ? queueItems[queueIndex]?.siteId : undefined;
  useEffect(() => {
    if (!queueOpen) return;
    if (!queueSiteId) {
      setSelected(null);
      return;
    }
    const deal = dealFeatures.find((feature) => feature.properties.deal_id === queueSiteId)?.properties;
    const patch: Record<string, string | null> = { site: queueSiteId, view: "queue", funnel: "pipeline", tab: "pipeline", table: null };
    if (deal && (deal.city === "PHX" || deal.city === "LAS" || deal.city === "MIA")) patch.city = deal.city === "PHX" ? null : deal.city;
    if (deal && (deal.stage_group === "desk" || deal.stage_group === "contacted" || deal.stage_group === "later" || deal.stage_group === "dropped")) {
      patch.pstage = deal.stage_group === "desk" ? null : deal.stage_group;
    }
    setSelected(queueSiteId);
    write(patch);
  }, [queueOpen, queueSiteId]);

  if (error) {
    return (
      <main className="empty">
        <Wordmark level="p" />
        <p>{error}</p>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="empty">
        <Wordmark level="p" />
        <p>Loading</p>
      </main>
    );
  }

  const focus = CITY_VIEW[city] ?? CITY_VIEW.PHX;
  const dropCount = sites.filter((site) => droppedAt(site, stage) && site.city === city).length;

  const sheet = { expanded: sheetExpanded, onToggle: () => setSheetExpanded((value) => !value) };
  const unplacedDeals = dealRows.filter((deal) => deal.kind === "pipeline" && deal.city === city && !dealPoint(deal));
  const offMarketShown = funnel === "pipeline" || extra ? [] : offMarketFeatures.filter((feature) => {
    if (!feature.geometry) return false;
    if (stage !== "universe" && !inStage(feature.properties, stage)) return false;
    return passesChips(feature.properties, false);
  });
  const universePins = showUniverse ? visibleFeatures.filter((feature) => feature.geometry) : [];
  const unscreenedPins = showUnscreened ? unscreened.filter((feature) => feature.properties.city === city && feature.geometry) : [];
  const pinCount = (funnel === "pipeline" ? pipelineSquares.length : universePins.length + offMarketShown.length) + unscreenedPins.length;
  const siteById = new Map(sites.map((site) => [site.site_id, site]));

  function siteRow(site: SiteProps): ListRow {
    const price = site.listed && site.asking_price_display ? `${site.asking_price_display}${site.asking_price_source ? ` · ${site.asking_price_source}` : ""}` : "";
    return {
      id: site.site_id,
      site: site.name || site.address || site.site_id,
      type: site.business_type || "Car wash",
      city: site.city,
      stage: plainVerdict(site.verdict),
      tier: tierLabel(site.land_tier) || "",
      spare: site.spare_ac_own != null ? `${site.spare_ac_own} ac` : "",
      zoning: site.zoning || "",
      traffic: site.aadt_count ? `${site.aadt_count}${site.aadt_road ? ` on ${plainRoad(site.aadt_road)}` : ""}` : "",
      listed: site.listed ? `Yes${price ? ` · ${price}` : ""}` : "No",
      lead: leadSourceLine(site, dealRows.find((deal) => deal.deal_id === site.linked_deal_id || deal.universe_id === site.site_id)),
    };
  }

  function dealRow(deal: DealProps): ListRow {
    const linked = deal.universe_id ? siteById.get(deal.universe_id) : undefined;
    const price = deal.asking_price_display ? `${deal.asking_price_display}${deal.asking_price_source ? ` · ${deal.asking_price_source}` : ""}` : "";
    return {
      id: deal.deal_id,
      site: deal.name || deal.address || deal.deal_id,
      type: deal.business_type || "Other",
      city: deal.city,
      stage: stageDetail(deal.stage, deal.stage_group),
      tier: linked ? tierLabel(linked.land_tier) || "" : "",
      spare: linked?.spare_ac_own != null ? `${linked.spare_ac_own} ac` : "",
      zoning: linked?.zoning || "",
      traffic: linked?.aadt_count ? `${linked.aadt_count}${linked.aadt_road ? ` on ${plainRoad(linked.aadt_road)}` : ""}` : "",
      listed: price || (deal.listed ? "Yes" : "No"),
      lead: [deal.broker, deal.firm].filter(Boolean).join(" · "),
    };
  }

  function unscreenedRow(row: UnscreenedProps): ListRow {
    const price = row.asking_price_display ? `${row.asking_price_display}${row.asking_price_source ? ` · ${row.asking_price_source}` : ""}` : "";
    return {
      id: row.listing_id,
      site: row.name || row.address || row.listing_id,
      type: row.kind,
      city: row.city,
      stage: row.approximate ? "Approximate location" : row.pinned ? "Listed" : "Address withheld",
      tier: "",
      spare: row.acres_text || (row.acres != null ? `${row.acres} ac` : ""),
      zoning: "",
      traffic: "",
      listed: price || "Yes",
      lead: row.asking_price_source || "Listing",
    };
  }

  const listRows = [...(funnel === "pipeline"
    ? pipelineSquares.map((feature) => dealRow(feature.properties))
    : [...universePins.map((feature) => siteRow(feature.properties)), ...offMarketShown.map((feature) => siteRow(feature.properties))]
  ), ...(showUnscreened ? unscreened.filter((feature) => feature.properties.city === city).map((feature) => unscreenedRow(feature.properties)) : [])].sort((a, b) => {
    const left = String(a[sortKey] || "").trim();
    const right = String(b[sortKey] || "").trim();
    if (!left && !right) return 0;
    if (!left) return 1;
    if (!right) return -1;
    const diff = left.localeCompare(right, undefined, { numeric: true });
    return sortDesc ? -diff : diff;
  });

  function exportList() {
    const blob = new Blob([listCsv(listRows)], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${city}-list.csv`;
    link.click();
  }

  const activeFilters: { id: string; label: string; clear: () => void }[] = [];
  if (businessTypes) activeFilters.push({ id: "types", label: businessTypes.join(", "), clear: () => setBusinessTypes(null) });
  if (landTier !== "any") activeFilters.push({ id: "tier", label: tierLabel(landTier) || "Spare land", clear: () => write({ tier: null }) });
  if (verdict !== "any") activeFilters.push({ id: "verdict", label: plainVerdict(verdict), clear: () => write({ verdict: null }) });
  if (listed === "yes") activeFilters.push({ id: "listed", label: "Listed", clear: () => write({ listed: null }) });
  if (landSites) activeFilters.push({ id: "land", label: "Land sites", clear: () => write({ land: null }) });
  if (compare) activeFilters.push({ id: "compare", label: "Reviews disagree", clear: () => write({ disagree: null }) });
  if (showDropped) activeFilters.push({ id: "ruled", label: "Ruled out", clear: () => write({ ruled: null }) });
  if (extra === "held") activeFilters.push({ id: "held", label: "Held outside the service area", clear: () => write({ extra: null }) });

  function closeMenus() {
    setFiltersOpen(false);
    setMoreOpen(false);
    setUserOpen(false);
    setMenuOpen(false);
    setUnplacedOpen(false);
  }

  function summaryText() {
    if (funnel === "pipeline") {
      const deals = dealRows.filter((deal) => deal.kind === "pipeline" && deal.city === city);
      const land = dealRows.filter((deal) => deal.kind === "land" && deal.city === city);
      const activeDeals = deals.filter((deal) => deal.stage_group !== "dropped").length;
      const droppedDeals = deals.length - activeDeals;
      const activeLand = land.filter((deal) => deal.stage_group !== "dropped").length;
      const droppedLand = land.length - activeLand;
      return `${activeDeals} deals + ${activeLand} land sites, ${droppedDeals} dropped deals + ${droppedLand} dropped land sites`;
    }
    const candidates = sites.filter((site) => site.city === city && inStage(site, "land")).length;
    const cleared = sites.filter((site) => site.city === city && inStage(site, "cleared")).length;
    return `${candidates} candidates, ${cleared} cleared`;
  }

  return (
    <div ref={bindShell} className={`shell ${tableOpen ? "table-open" : ""} ${listView ? "list-open" : ""} ${selected ? "drawer-open" : ""}`} data-visible={visibleSites.length} data-city={city} data-stage={stage} data-pin-count={pinCount} data-list-count={listRows.length}>
      {(filtersOpen || moreOpen || userOpen || menuOpen || unplacedOpen) ? (
        <button className="backdrop" type="button" aria-label="Close menu" onClick={closeMenus} />
      ) : null}
      <header className="bar">
        <div className="top">
          <Wordmark view={tableOpen ? "list" : "map"} />
          <div className="cities only-desktop" role="group" aria-label="City">
            {CITIES.map((item) => (
              <button key={item} className={city === item ? "on" : ""} type="button" onClick={() => jump(item)}>
                {item === "PHX" ? "Phoenix" : item === "LAS" ? "Las Vegas" : "Miami"}
              </button>
            ))}
          </div>
          <label className="city-pick only-mobile">
            <span className="sr">City</span>
            <select aria-label="City" value={city} onChange={(event) => jump(event.target.value)}>
              <option value="PHX">Phoenix</option>
              <option value="LAS">Las Vegas</option>
              <option value="MIA">Miami</option>
            </select>
          </label>
          <input className="search only-desktop" placeholder="Address, APN, owner, id" value={query} onChange={(event) => write({ q: event.target.value || null })} />
          <div className="funnel-switch only-desktop" role="group" aria-label="Which funnel">
            <button className={funnel === "universe" ? "on" : ""} type="button" onClick={() => write({ funnel: null, tab: null })}>Universe</button>
            <button className={funnel === "pipeline" ? "on" : ""} type="button" onClick={() => write({ funnel: "pipeline", tab: "pipeline" })}>Pipeline</button>
          </div>
          <div className="funnel-switch only-desktop" role="group" aria-label="Map or list">
            <button className={!listView && !queueOpen ? "on" : ""} type="button" onClick={() => write({ view: null })}>Map</button>
            <button className={listView ? "on" : ""} type="button" onClick={() => write({ view: "list" })}>List</button>
            {me?.actionsEnabled ? (
              <button className={queueOpen ? "on" : ""} type="button" onClick={() => { setQueueIndex(0); write({ view: queueOpen ? null : "queue" }); }}>
                Queue{queueCount ? <span className="count-badge" data-testid="queue-count">{queueCount}</span> : null}
              </button>
            ) : null}
          </div>
          <div className="user-menu only-desktop">
            <button className="avatar" type="button" aria-haspopup="menu" aria-expanded={userOpen} aria-label={me?.u ? `Account menu for ${me.u}` : "Account menu"} onClick={() => { setUserOpen((value) => !value); setFiltersOpen(false); setMoreOpen(false); }}>
              {(me?.u || "?").slice(0, 1).toUpperCase()}
            </button>
            {userOpen ? (
              <div className="menu" role="menu">
                <p className="menu-note">{me?.u}</p>
                {me?.role === "admin" ? <a role="menuitem" href="/admin">Accounts</a> : null}
                <button type="button" role="menuitem" onClick={logout}>Sign out</button>
              </div>
            ) : null}
          </div>
          <button className="icon-btn only-mobile" type="button" aria-pressed={searchOpen} aria-label={searchOpen ? "Hide search" : "Search"} onClick={() => setSearchOpen((value) => !value)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="M16 16l5 5" /></svg>
          </button>
          <button className="icon-btn only-mobile" type="button" aria-expanded={menuOpen} aria-label="Menu" onClick={() => { setMenuOpen((value) => !value); setFiltersOpen(false); setLegendOpen(false); setLayersOpen(false); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        </div>
        <div className="funnel-switch only-mobile" role="group" aria-label="Map, list, or queue">
          <button className={!listView && !queueOpen ? "on" : ""} type="button" onClick={() => write({ view: null })}>Map</button>
          <button className={listView ? "on" : ""} type="button" onClick={() => write({ view: "list" })}>List</button>
          {me?.actionsEnabled ? (
            <button className={queueOpen ? "on" : ""} type="button" onClick={() => { setQueueIndex(0); write({ view: queueOpen ? null : "queue" }); }}>
              Queue{queueCount ? <span className="count-badge">{queueCount}</span> : null}
            </button>
          ) : null}
        </div>
        {searchOpen ? (
          <input className="search mobile-search" placeholder="Address, APN, owner, id" value={query} onChange={(event) => write({ q: event.target.value || null })} />
        ) : null}
        <div className="funnel-row">
          <nav className={funnel === "pipeline" ? "funnel compact" : "funnel"} aria-label="Funnel">
            {funnel === "universe" ? STEPS.map((step, index) => {
              const listedHere = subcount(step.id, "listed");
              const contactedHere = subcount(step.id, "contacted");
              const note = step.id === "universe"
                ? `Built from ${censusForCity.toLocaleString()} census records. The count keeps the rows the workbook includes.`
                : FUNNEL_NOTES[step.id];
              return (
                <Fragment key={step.id}>
                  {index > 0 ? <span className="chev" aria-hidden="true">›</span> : null}
                  <span className="step">
                    <button className={stage === step.id && extra !== "listed" && extra !== "contacted" ? "on" : ""} type="button" aria-current={stage === step.id && !extra ? "step" : undefined} title={note} onMouseEnter={() => setTip(note)} onMouseLeave={() => setTip("")} onClick={() => write({ stage: step.id === "land" ? null : step.id, extra: null, ruled: null }, true)}>
                      <span>{step.label}</span>
                      <strong data-count={step.id === stage && extra == null ? visibleSites.length : filteredAt(step.id)}>{stepBadge(step.id)}</strong>
                    </button>
                    {listedHere > 0 ? (
                      <button className={`sub ${extra === "listed" && stage === step.id ? "on" : ""}`} type="button" title={FUNNEL_NOTES.listed} onMouseEnter={() => setTip(FUNNEL_NOTES.listed)} onMouseLeave={() => setTip("")} onClick={() => write({ stage: step.id === "land" ? null : step.id, extra: extra === "listed" ? null : "listed" })}>
                        {listedHere.toLocaleString()} listed
                      </button>
                    ) : null}
                    {contactedHere > 0 ? (
                      <button className={`sub ${extra === "contacted" && stage === step.id ? "on" : ""}`} type="button" title={FUNNEL_NOTES.contacted} onMouseEnter={() => setTip(FUNNEL_NOTES.contacted)} onMouseLeave={() => setTip("")} onClick={() => write({ stage: step.id === "land" ? null : step.id, extra: extra === "contacted" ? null : "contacted" })}>
                        {contactedHere.toLocaleString()} broker contacted
                      </button>
                    ) : null}
                  </span>
                </Fragment>
              );
            }) : PIPE_STEPS.map((step, index) => {
              const rows = dealRows.filter((deal) => {
                if (deal.kind !== "pipeline" || deal.city !== city || deal.stage_group !== step.id) return false;
                if (!typeOn(deal.business_type || "Other")) return false;
                if (!query) return true;
                const blob = `${deal.deal_id} ${deal.name} ${deal.address} ${deal.broker} ${deal.firm} ${deal.universe_id}`.toLowerCase();
                return blob.includes(query.toLowerCase());
              });
              const landHere = dealRows.filter((deal) => {
                if (deal.kind !== "land" || deal.city !== city || deal.stage_group !== step.id) return false;
                if (!typeOn(deal.business_type || "Other")) return false;
                if (!query) return true;
                return `${deal.deal_id} ${deal.name} ${deal.address}`.toLowerCase().includes(query.toLowerCase());
              });
              const total = rows.length + landHere.length;
              const unmapped = [...rows, ...landHere].filter((deal) => !dealPoint(deal)).length;
              const brokerHere = [...rows, ...landHere].filter((deal) => deal.broker_contacted).length;
              const split = landHere.length > 0 ? ` (${rows.length.toLocaleString()} deals, ${landHere.length.toLocaleString()} land)` : "";
              return (
                <Fragment key={step.id}>
                  {index > 0 ? <span className="chev" aria-hidden="true">›</span> : null}
                  <span className="step">
                    <button className={pipeStage === step.id ? "on" : ""} type="button" aria-current={pipeStage === step.id ? "step" : undefined} title={`${FUNNEL_NOTES[step.id]}${brokerHere ? ` ${brokerHere} broker contacted.` : ""}`} onMouseEnter={() => setTip(`${FUNNEL_NOTES[step.id]}${brokerHere ? ` ${brokerHere} broker contacted.` : ""}`)} onMouseLeave={() => setTip("")} onClick={() => write({ pstage: step.id === "desk" ? null : step.id }, true)}>
                      <span>{step.label}</span>
                      <strong>{total.toLocaleString()}</strong>
                      {split ? <span className="split">{split}</span> : null}
                    </button>
                    {pipeStage === step.id && unmapped > 0 ? <span className="sub">{unmapped.toLocaleString()} without a location</span> : null}
                  </span>
                </Fragment>
              );
            })}
          </nav>
            {showUnscreened && withheldHere.length > 0 ? (
              <button className={`aside ${withheldOpen ? "on" : ""}`} type="button" onClick={() => { setWithheldOpen((value) => !value); setUnplacedOpen(false); setMoreOpen(false); setFiltersOpen(false); }}>
                {withheldHere.length.toLocaleString()} address withheld
              </button>
            ) : null}
            {funnel === "pipeline" && unplacedDeals.length > 0 ? (
              <button className={`aside only-desktop ${unplacedOpen ? "on" : ""}`} type="button" onClick={() => { setUnplacedOpen((value) => !value); setWithheldOpen(false); setMoreOpen(false); setFiltersOpen(false); }}>
                All stages not on the map ({unplacedDeals.length.toLocaleString()})
              </button>
            ) : null}
          {query && funnel === "universe" && stage !== "universe" ? (
            (() => {
              const everywhere = sites.filter((site) => site.city === city && inStage(site, "universe") && passesChips(site, false)).length;
              const here = sites.filter((site) => inStage(site, stage) && passesChips(site, false)).length;
              const more = everywhere - here;
              if (more <= 0) return null;
              return <button className="aside" type="button" onClick={() => write({ stage: "universe" }, true)}>{more.toLocaleString()} more at other steps</button>;
            })()
          ) : null}
          <span
            className="summary-chip"
            title={funnel === "pipeline" ? SUMMARY_NOTES.pipeline : SUMMARY_NOTES.universe}
            onMouseEnter={() => setTip(funnel === "pipeline" ? SUMMARY_NOTES.pipeline : SUMMARY_NOTES.universe)}
            onMouseLeave={() => setTip("")}
          >
            {summaryText()}
          </span>
          {data.funnel.workbook_as_of ? <span className="summary-chip as-of">Data as of {data.funnel.workbook_as_of}</span> : null}
          <button className={`tool only-desktop ${filtersOpen ? "on" : ""}`} type="button" aria-expanded={filtersOpen} onClick={() => { setFiltersOpen((value) => !value); setMoreOpen(false); setUserOpen(false); setUnplacedOpen(false); }}>
            Filters
            {activeFilters.length ? <span className="count-badge">{activeFilters.length}</span> : null}
          </button>
          <div className="more-wrap only-desktop">
            <button className={`tool ${moreOpen ? "on" : ""}`} type="button" aria-expanded={moreOpen} onClick={() => { setMoreOpen((value) => !value); setFiltersOpen(false); setUserOpen(false); setUnplacedOpen(false); }}>More</button>
            {moreOpen ? (
              <div className="menu" role="menu">
                <button type="button" onClick={exportTable}>Export CSV</button>
                <button type="button" onClick={() => { write({ table: tableOpen ? null : "1" }); setMoreOpen(false); }}>{tableOpen ? "Hide table" : "Table"}</button>
                <button type="button" onClick={() => void copyLink()}>{copied ? "Link copied" : "Copy link"}</button>
                <ActionsMenuButtons close={() => setMoreOpen(false)} />
                <button type="button" onClick={() => { setGuideOpen(true); setMoreOpen(false); }}>How to read this</button>
                {changesNote ? <p className="menu-note">{changesNote}</p> : null}
              </div>
            ) : null}
          </div>
        </div>
        {activeFilters.length ? (
          <div className="active-row" aria-label="Active filters">
            {activeFilters.map((item) => (
              <button key={item.id} className="removable" type="button" onClick={item.clear}>
                {item.label}
                <span aria-hidden="true">×</span>
                <span className="sr">Remove</span>
              </button>
            ))}
          </div>
        ) : null}
        {filtersOpen ? (
          <div className="popover" role="dialog" aria-label="Filters">
            <div className="popover-head">
              <h2>Filters</h2>
              <button type="button" onClick={() => setFiltersOpen(false)}>Close</button>
            </div>
            <h3>Business type</h3>
            <div className="type-filters">
              <button type="button" className={businessTypes === null ? "on" : ""} onClick={() => setBusinessTypes(null)}>All types</button>
              {BUSINESS_TYPES.map((type) => {
                const inStep = sites.filter((site) => site.city === city && inStage(site, stage) && (site.business_type || "Car wash") === type).length;
                const offCount = offMarketFeatures.filter((feature) => (feature.properties.business_type || "Other") === type).length;
                const shown = funnel === "pipeline"
                  ? dealRows.filter((deal) => deal.kind === "pipeline" && deal.city === city && deal.stage_group === pipeStage && (deal.business_type || "Other") === type && Boolean(dealPoint(deal))).length
                  : inStep || offCount;
                if (shown === 0 && type !== "Car wash") return null;
                return (
                  <button key={type} type="button" title={type === "Car wash" ? CENSUS_NOTE : undefined} className={typeOn(type) && businessTypes !== null ? "on" : businessTypes === null ? "on" : ""} onClick={() => toggleType(type)}>
                    {type} {shown.toLocaleString()}
                  </button>
                );
              })}
            </div>
            {funnel === "universe" ? (
              <>
                <h3>Spare land</h3>
                <div className="chips">
                  {(["any", "L10", "L4"] as const).map((item) => (
                    <button key={item} className={landTier === item ? "on" : ""} type="button" title={item === "any" ? "" : TIER_NOTES[item].note} onMouseEnter={() => item !== "any" && setTip(TIER_NOTES[item].note)} onMouseLeave={() => setTip("")} onClick={() => write({ tier: item === "any" ? null : item })}>
                      {item === "any" ? "All tiers" : <><i className={`swatch ${item === "L10" ? "l10" : "l4"}`} /> {TIER_NOTES[item].label}</>}
                    </button>
                  ))}
                </div>
                <h3>Status</h3>
                <div className="chips">
                  {[
                    ["any", "All statuses"],
                    ["PASS", "Cleared"],
                    ["MAYBE", "Possible"],
                    ["UNRESOLVED", "Unresolved"],
                  ].map(([item, label]) => (
                    <button key={item} className={verdict === item ? "on" : ""} type="button" onClick={() => write({ verdict: item === "any" ? null : item })}>
                      {label}
                    </button>
                  ))}
                  <button className={listed === "yes" ? "on" : ""} type="button" onClick={() => write({ listed: listed === "yes" ? null : "yes" })}>Listed</button>
                  <button className={landSites ? "on" : ""} type="button" onClick={() => write({ land: landSites ? null : "1" })}>Land sites</button>
                  <button className={compare ? "on" : ""} type="button" onClick={() => write({ disagree: compare ? null : "1" })}>Reviews disagree</button>
                  {dropCount > 0 ? (
                    <button className={showDropped ? "on" : ""} type="button" onClick={() => write({ ruled: showDropped ? null : "1" })}>
                      Ruled out ({dropCount.toLocaleString()})
                    </button>
                  ) : null}
                  {heldCount > 0 ? (
                    <button className={extra === "held" ? "on" : ""} type="button" onClick={() => write({ stage: null, extra: extra === "held" ? null : "held" })}>
                      Held outside the service area ({heldCount.toLocaleString()})
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        ) : null}
        {menuOpen ? (
          <div className="popover menu-sheet" role="dialog" aria-label="Menu">
            <div className="popover-head">
              <div>
                <h2>Menu</h2>
                {data.funnel.workbook_as_of ? <p className="as-of-line">Data as of {data.funnel.workbook_as_of}</p> : null}
              </div>
              <button type="button" onClick={() => setMenuOpen(false)}>Close</button>
            </div>
            <div className="funnel-switch segment" role="group" aria-label="Which funnel">
              <button className={funnel === "universe" ? "on" : ""} type="button" onClick={() => write({ funnel: null, tab: null })}>Universe</button>
              <button className={funnel === "pipeline" ? "on" : ""} type="button" onClick={() => write({ funnel: "pipeline", tab: "pipeline" })}>Pipeline</button>
            </div>
            <button type="button" onClick={() => { setFiltersOpen(true); setMenuOpen(false); }}>Filters{activeFilters.length ? ` (${activeFilters.length})` : ""}</button>
            <button type="button" onClick={() => { setLayersOpen(true); setMenuOpen(false); }}>Layers</button>
            <button type="button" onClick={() => { setLegendOpen(true); setMenuOpen(false); }}>Legend</button>
            <button type="button" onClick={() => { write({ table: tableOpen ? null : "1" }); setMenuOpen(false); }}>{tableOpen ? "Hide table" : "Table"}</button>
            <button type="button" onClick={exportTable}>Export CSV</button>
            <button type="button" onClick={() => void copyLink()}>{copied ? "Link copied" : "Copy link"}</button>
            <ActionsMenuButtons close={() => setMenuOpen(false)} />
            <button type="button" onClick={() => { write({ view: listView ? null : "list" }); setMenuOpen(false); }}>{listView ? "Map" : "List"}</button>
            {me?.actionsEnabled ? (
              <button type="button" onClick={() => { write({ view: "queue" }); setMenuOpen(false); }}>Queue{queueCount ? ` (${queueCount})` : ""}</button>
            ) : null}
            <button type="button" onClick={() => { setGuideOpen(true); setMenuOpen(false); }}>How to read this</button>
            {funnel === "pipeline" && unplacedDeals.length > 0 ? (
              <button type="button" onClick={() => { setUnplacedOpen(true); setMenuOpen(false); }}>Not on the map, all stages ({unplacedDeals.length.toLocaleString()})</button>
            ) : null}
            {changesNote ? <p className="menu-note">{changesNote}</p> : null}
            <p className="menu-note">{me?.u}</p>
            {me?.role === "admin" ? <a href="/admin">Accounts</a> : null}
            <button type="button" onClick={logout}>Sign out</button>
          </div>
        ) : null}
        {withheldOpen ? (
          <div className="popover" role="dialog" aria-label="Address withheld">
            <div className="popover-head">
              <h2>{withheldHere.length.toLocaleString()} address withheld</h2>
              <button type="button" onClick={() => setWithheldOpen(false)}>Close</button>
            </div>
            <ul className="unplaced-list">
              {withheldHere.map((feature) => (
                <li key={feature.properties.listing_id}>
                  <button type="button" className="text-link" onClick={() => { choose(feature.properties.listing_id); setWithheldOpen(false); }}>{feature.properties.name}</button>
                  {" · "}{feature.properties.kind}
                  {feature.properties.asking_price_display ? ` · ${feature.properties.asking_price_display}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {unplacedOpen ? (
          <div className="popover" role="dialog" aria-label="Unplaced deals">
            <div className="popover-head">
              <h2>{unplacedDeals.length.toLocaleString()} deals not on the map</h2>
              <button type="button" onClick={() => setUnplacedOpen(false)}>Close</button>
            </div>
            <ul className="unplaced-list">
              {unplacedDeals.map((deal) => (
                <li key={deal.deal_id}>
                  <button type="button" className="text-link" onClick={() => { choose(deal.deal_id); setUnplacedOpen(false); }}>{deal.name || deal.address || deal.deal_id}</button>
                  {" · "}{stageTitle(deal.stage_group)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </header>

      <div className="map-stage">
        <ActionsDialogs />
        {queueOpen && me?.actionsEnabled ? (
          <QueueBar
            count={queueItems.length}
            firstTime={queueFirst}
            market={queueMarket}
            stage={queueStage}
            viable={queueViable}
            freshOnly={queueFresh}
            flaggedOnly={queueFlagged}
            approvalOnly={queueApproval}
            mentionsOnly={queueMentions}
            assignedOnly={queueAssigned}
            onFilter={(patch) => {
              const next = { ...patch, view: "queue" };
              if ("qmarket" in next && next.qmarket === city) next.qmarket = null;
              setQueueIndex(0);
              write(next);
            }}
            onMarkAll={() => {
              void fetch("/api/queue", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  all: true,
                  market: queueMarket,
                  stage: queueStage,
                  viable: queueViable,
                  fresh: queueFresh,
                  flagged: queueFlagged,
                  approve: queueApproval,
                  mentions: queueMentions,
                  assigned: queueAssigned,
                }),
              }).then(() => window.dispatchEvent(new Event("queue-refresh")));
            }}
          />
        ) : null}
        {queueOpen && me?.actionsEnabled && queueItems.length === 0 ? <QueueEmpty /> : null}
        <MapView
          sites={funnel === "pipeline" ? (showUniverse ? pipelineSites : []) : (showUniverse ? visibleFeatures : [])}
          deals={drawnDeals}
          areas={data.areas.features}
          depots={data.depots.features}
          parcels={data.parcels.features}
          offMarket={offMarketShown}
          unscreened={showUnscreened ? unscreened.filter((feature) => feature.properties.city === city && feature.geometry) : []}
          selectedId={selected}
          showAreas={showAreas}
          showDepots={showDepots}
          showSites={showUniverse}
          showRings={showRings}
          focusLng={focus.center[0]}
          focusLat={focus.center[1]}
          focusZoom={focus.zoom}
          onSelect={(id) => {
            if (dealRows.some((deal) => deal.deal_id === id)) setTableTab(dealRows.find((deal) => deal.deal_id === id)?.kind === "land" ? "land" : "pipeline");
            choose(id);
          }}
          onBounds={() => undefined}
        />
        {funnel === "universe" && !listView && visibleSites.length === 0 ? (
          <p className="empty-map">{compare ? `No disagreements in ${city === "PHX" ? "Phoenix" : city === "LAS" ? "Las Vegas" : "Miami"}.` : query ? "No matches." : "Nothing to show for this step."}</p>
        ) : null}
        {listView ? (
          <ListView
            rows={listRows}
            selectedId={selected}
            sort={{ id: sortKey, desc: sortDesc }}
            onSort={(id, desc) => write({ sort: `${id}:${(desc ?? (sortKey === id ? !sortDesc : false)) ? "desc" : "asc"}` })}
            onOpen={choose}
            onShowMap={(id) => { setSelected(id); write({ view: null, site: id }); }}
            onExport={exportList}
          />
        ) : null}
        <aside className={`layers ${layersOpen ? "open" : ""}`}>
          <button type="button" onClick={() => setLayersOpen((value) => !value)}>{layersOpen ? "Hide layers" : "Layers"}</button>
          {layersOpen ? (
            <>
              <label><input type="checkbox" checked={showAreas} onChange={(event) => write({ areas: event.target.checked ? null : "0" })} /> Service areas</label>
              <label><input type="checkbox" checked={showDepots} onChange={(event) => write({ depots: event.target.checked ? null : "0" })} /> Depots</label>
              <label><input type="checkbox" checked={showUniverse} onChange={(event) => write({ pins: event.target.checked ? null : "0" })} /> Universe sites</label>
              <label><input type="checkbox" checked={showPipeline} onChange={(event) => write({ deals: event.target.checked ? null : "0" })} /> Pipeline deals</label>
              <label><input type="checkbox" checked={showLandLayer} onChange={(event) => write({ landlayer: funnel === "pipeline" ? (event.target.checked ? null : "0") : (event.target.checked ? "1" : null) })} /> Land Sites</label>
              <label><input type="checkbox" checked={showDroppedDeals} onChange={(event) => write({ dropped: event.target.checked ? "1" : null })} /> Dropped deals</label>
              <label><input type="checkbox" checked={showRings} onChange={(event) => write({ rings: event.target.checked ? "1" : null })} /> Depot rings</label>
              <label>
                <input type="checkbox" checked={showUnscreened} onChange={(event) => write({ newlist: event.target.checked ? "1" : null })} />
                <span>
                  Listed, not yet screened
                  <span className="layer-meta">
                    {unscreened.filter((feature) => feature.properties.pinned).length.toLocaleString()} on the map
                    {" · "}
                    {unscreened.filter((feature) => !feature.properties.pinned).length.toLocaleString()} address withheld
                  </span>
                </span>
              </label>
            </>
          ) : null}
        </aside>
        <div className={`legend ${legendOpen ? "open" : ""}`} onMouseLeave={() => setTip("")}>
          <button type="button" onClick={() => { setLegendOpen((value) => !value); setMenuOpen(false); }}>{legendOpen ? "Hide legend" : "Legend"}</button>
          {legendOpen ? (
            <ul>
              {STATUS_NOTES.map((item) => (
                <li key={item.id} onMouseEnter={() => setTip(item.note)} onMouseLeave={() => setTip("")} onClick={() => setTip(item.note)}>
                  <i className={`swatch ${item.id}`} /> {item.label}
                </li>
              ))}
              <li onMouseEnter={() => setTip(TIER_NOTES.L10.note)} onMouseLeave={() => setTip("")} onClick={() => setTip(TIER_NOTES.L10.note)}><i className="swatch l10" /> {TIER_NOTES.L10.label}</li>
              <li onMouseEnter={() => setTip(TIER_NOTES.L4.note)} onMouseLeave={() => setTip("")} onClick={() => setTip(TIER_NOTES.L4.note)}><i className="swatch l4" /> {TIER_NOTES.L4.label}</li>
              <li onMouseEnter={() => setTip(AREA_NOTES.current)} onMouseLeave={() => setTip("")} onClick={() => setTip(AREA_NOTES.current)}><i className="swatch current-area" /> {AREA_KIND_LABEL.current}</li>
              <li onMouseEnter={() => setTip(AREA_NOTES.later)} onMouseLeave={() => setTip("")} onClick={() => setTip(AREA_NOTES.later)}><i className="swatch later-area" /> {AREA_KIND_LABEL.later}</li>
            </ul>
          ) : null}
          {tip ? <p className="tip">{tip}</p> : null}
        </div>
        {guideOpen ? (
          <aside className="guide">
            <button className="close" type="button" onClick={() => setGuideOpen(false)}>Close</button>
            <h2>How to read this</h2>
            <p>The universe funnel starts with one site for each place. The hover note on Universe says how many census records were merged to get there. Each later step keeps only the sites that passed the step before it.</p>
            <p>When a step has sites on the market, a count beside it lists them. Click that count to show those sites. A larger site has about 10,000 sq ft of spare land. A smaller site has about 4,000.</p>
            <p>Held sites are cleared on the land, but they sit outside the current service area. They are not counted in the in-area steps.</p>
            <ul>
              {STATUS_NOTES.map((item) => <li key={item.id}><strong>{item.label}.</strong> {item.note}</li>)}
            </ul>
          </aside>
        ) : null}
        {selectedDeal ? (
          <DealDetail
            deal={selectedDeal}
            universeName={sites.find((site) => site.site_id === selectedDeal.universe_id)?.name}
            depotMiles={selectedDeal.miles_to_depot}
            lng={dealPoint(selectedDeal)?.[0]}
            lat={dealPoint(selectedDeal)?.[1]}
            onOpenSite={selectedDeal.universe_id ? () => choose(selectedDeal.universe_id) : undefined}
            onClose={() => choose(null)}
            sheet={sheet}
            banner={queueOpen && queueItems[queueIndex]?.siteId === selectedDeal.deal_id ? (
              <QueueControls
                item={queueItems[queueIndex]}
                index={queueIndex}
                total={queueItems.length}
                onPrev={() => setQueueIndex((current) => Math.max(0, current - 1))}
                onNext={() => setQueueIndex((current) => Math.min(queueItems.length - 1, current + 1))}
                onReviewed={() => {
                  const id = queueItems[queueIndex]?.siteId;
                  if (!id) return;
                  void fetch("/api/queue", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ siteId: id }),
                  }).then(() => window.dispatchEvent(new Event("queue-refresh")));
                }}
              />
            ) : null}
            extras={<RecordActions kind="deal" id={selectedDeal.deal_id} />}
          />
        ) : selectedUnscreened ? (
          <UnscreenedDetail
            row={selectedUnscreened}
            lng={unscreened.find((feature) => feature.properties.listing_id === selectedUnscreened.listing_id)?.geometry?.coordinates?.[0]}
            lat={unscreened.find((feature) => feature.properties.listing_id === selectedUnscreened.listing_id)?.geometry?.coordinates?.[1]}
            onClose={() => choose(null)}
            sheet={sheet}
          />
        ) : selectedSite ? (
          <Detail
            site={selectedSite}
            lng={featureById.get(selectedSite.site_id)?.geometry?.coordinates?.[0]}
            lat={featureById.get(selectedSite.site_id)?.geometry?.coordinates?.[1]}
            depotMiles={(() => {
              const feature = featureById.get(selectedSite.site_id);
              const coords = feature?.geometry?.coordinates;
              if (!coords || !data) return selectedSite.miles_to_depot;
              return nearestDepot(coords[0], coords[1], data.depots.features)?.miles ?? selectedSite.miles_to_depot;
            })()}
            linkedDeal={dealRows.find((deal) => deal.deal_id === selectedSite.linked_deal_id || deal.universe_id === selectedSite.site_id) || null}
            onOpenDeal={selectedSite.linked_deal_id ? () => choose(selectedSite.linked_deal_id || null) : undefined}
            onAddCompare={() => addCompare(selectedSite.site_id)}
            sameOwner={sites.filter((site) => site.site_id !== selectedSite.site_id && site.owner && site.owner === selectedSite.owner).slice(0, 6)}
            onClose={() => choose(null)}
            sheet={sheet}
            extras={<RecordActions kind="site" id={selectedSite.site_id} />}
          />
        ) : null}
        {compareIds.length >= 2 ? (
          <aside className="compare-panel">
            <button className="close" type="button" onClick={() => write({ compare: null })}>Close</button>
            <h2>Side by side</h2>
            <div className="compare-grid">
              {compareIds.map((id) => {
                const site = sites.find((item) => item.site_id === id);
                if (!site) return null;
                return (
                  <article key={id}>
                    <h3>{plainVerdict(site.verdict)}</h3>
                    <p>{site.name || site.address}</p>
                    <p className="note">{site.address}</p>
                    <p className="note">{site.owner || "Owner not on file"}</p>
                    <p className="note">{site.zoning || "Zoning not on file"}</p>
                  </article>
                );
              })}
            </div>
          </aside>
        ) : null}
      </div>
      {tableOpen ? (
        <section className="dock">
          <div className="dock-tabs">
            <button className="only-mobile" type="button" onClick={() => write({ table: null })}>Map</button>
            {(["universe", "pipeline", "land"] as const).map((tab) => (
              <button key={tab} className={tableTab === tab ? "on" : ""} type="button" onClick={() => setTableTab(tab)}>
                {tab === "universe" ? "Universe" : tab === "pipeline" ? "Pipeline" : "Land"}
              </button>
            ))}
          </div>
          {tableTab === "universe" ? <SiteTable rows={visibleSites} selectedId={selected} onSelect={choose} activity={activity} sorting={sortParam ? [{ id: sortParam.split(":")[0], desc: sortParam.endsWith(":desc") }] : []} onSortingChange={(next) => write({ sort: next[0] ? `${next[0].id}:${next[0].desc ? "desc" : "asc"}` : null })} /> : null}
          {tableTab === "pipeline" ? <DealTable rows={pipelineDeals} selectedId={selected} onSelect={choose} activity={activity} /> : null}
          {tableTab === "land" ? <DealTable rows={landDeals} selectedId={selected} onSelect={choose} activity={activity} /> : null}
        </section>
      ) : null}
    </div>
  );
}
