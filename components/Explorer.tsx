"use client";

import dynamic from "next/dynamic";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ActionsDialogs, ActionsMenuButtons } from "./actions/ActionsChrome";
import { FilterPopover, ReviewBar, ReviewFeedSheet, ReviewRail, WhatChanged, marketLabel, type FeedSite } from "./queue/QueueView";
import { RecordActions } from "./actions/RecordActions";
import Detail, { DealDetail, UnscreenedDetail } from "./Detail";
import Wordmark from "./Wordmark";
import ListView, { LIST_COLUMNS, listCsv, type ListRow } from "./ListView";
import PipelineList, { type PipelineRow } from "./PipelineList";
import CompareTray from "./CompareTray";
import SiteTable, { DealTable, siteExportHeaders, siteExportRow, type ActivitySummary } from "./SiteTable";
import { DRAWER_DEFAULT, DRAWER_WIDTH_KEY, clampDrawerWidth } from "@/lib/drawerWidth";
import { CITY_VIEW, CITIES, compareSites, droppedAt, heldOutside, inSelectedMarket, inStage, isLiveContactedDeal, matchesLandTier, matchesOpenLandTier, nearestDepot, presentSite, spareTier, type PipeId, type StageId } from "@/lib/filter";
import { areaQuery, inMapArea, parseMapArea } from "@/lib/geoFilter";
import { relatedRecords } from "@/lib/related";
import { readLinks, readSearches, readShortlists, removeSearch, removeShortlist, saveSearch, saveShortlist, setLinkStatus, proposeLink, type LinkProposal, type SavedSearch, type Shortlist } from "@/lib/savedSets";
import { APPROVER_LABEL } from "@/lib/actions/approver";
import { clearHidden, hideSite, readHidden } from "@/lib/hide";
import { OVERLAYS, overlayFeatures, parseOverlays, type OverlayId } from "@/lib/overlays";
import { leadSourceLine, plainRoad, shownBroker, shownFirm, shownPriceSource } from "@/lib/format";
import { collectSearchHits, dealSearchParts, matchesQuery, partyMatch, siteSearchParts, type SearchHit } from "@/lib/search";
import { PIPELINE_COLUMNS, capacitySummary, factsForDeal, factsForSite, inRange, parseColumns, rangeQuery, rangesFromSearch, type PinLabel, type PipelineColumnId } from "@/lib/keyNumbers";
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

function marketName(code: string) {
  if (code === "PHX") return "Phoenix";
  if (code === "LAS") return "Las Vegas";
  if (code === "MIA") return "Miami";
  return code;
}

function deepestStage(site: SiteProps): StageId {
  const order: StageId[] = ["cleared", "county", "land", "in_area", "universe"];
  for (const step of order) if (inStage(site, step)) return step;
  return "universe";
}

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
  useEffect(() => {
    const shell = shellRef.current;
    const bar = shell?.querySelector(".bar");
    if (!shell || !bar) return;
    shell.style.setProperty("--bar-h", `${bar.getBoundingClientRect().height}px`);
  });
  const [data, setData] = useState<AppData | null>(null);
  const [activity, setActivity] = useState<ActivitySummary>({});
  const [unscreened, setUnscreened] = useState<UnscreenedFeature[]>([]);
  const [detail, setDetail] = useState<SiteProps | null>(null);
  const [me, setMe] = useState<{ u: string; role: string; actionRole?: string; actionsEnabled?: boolean } | null>(null);
  const [figuresReady, setFiguresReady] = useState(!params.get("site"));
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [shortlists, setShortlists] = useState<Shortlist[]>([]);
  const [linkProposals, setLinkProposals] = useState<LinkProposal[]>([]);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [handoff, setHandoff] = useState("");
  const [searchName, setSearchName] = useState("");
  const [listName, setListName] = useState("");
  const [queueCount, setQueueCount] = useState(0);
  const [feed, setFeed] = useState<FeedSite[]>([]);
  const [feedLoaded, setFeedLoaded] = useState(false);
  const [undo, setUndo] = useState<{ siteId: string; previous: string | null; index: number } | null>(null);
  const [feedSheet, setFeedSheet] = useState(false);
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
  const [catalog, setCatalog] = useState<SiteFeature[] | null>(null);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [unplacedOpen, setUnplacedOpen] = useState(false);
  const [withheldOpen, setWithheldOpen] = useState(false);

  const allCities = params.get("city") === "all";
  const city = allCities ? "PHX" : (params.get("city") || "PHX");
  const allStages = params.get("stage") === "all";
  const stageParam = params.get("stage") as StageId | null;
  const stage: StageId = !allStages && stageParam && STEPS.some((step) => step.id === stageParam) ? stageParam : "land";
  const landTier = params.get("tier") || "any";
  const verdict = params.get("verdict") || "any";
  const listed = params.get("listed") || "any";
  const landSites = params.get("land") === "1";
  const query = params.get("q") || "";
  const who = params.get("who") || "";
  const funnel = params.get("funnel") === "pipeline" ? "pipeline" : "universe";
  const showLandLayer = funnel === "pipeline" ? params.get("landlayer") !== "0" : params.get("landlayer") === "1";
  const extraParam = params.get("extra");
  const extra = extraParam === "listed" || extraParam === "contacted" || extraParam === "held" ? extraParam : null;
  const allPipes = params.get("pstage") === "all";
  const pipeParam = params.get("pstage") as PipeId | null;
  const pipeStage: PipeId = !allPipes && pipeParam && PIPE_STEPS.some((step) => step.id === pipeParam) ? pipeParam : "desk";
  const listView = params.get("view") === "list";
  const sortParam = params.get("sort") || "site:asc";
  const sortKey = (LIST_COLUMNS.some((column) => column.id === sortParam.split(":")[0]) ? sortParam.split(":")[0] : "site") as keyof Omit<ListRow, "id">;
  const sortDesc = sortParam.endsWith(":desc");
  const reviewing = params.get("review") === "1";
  const queueMarket = params.get("qmarket") || city;
  const queueStage = params.get("qstage") || (funnel === "pipeline" ? pipeStage : "any");
  const queueViable = params.get("qviable") !== "0";
  const queueFresh = params.get("qnew") === "1";
  const queueFlagged = params.get("qflag") === "1";
  const queueApproval = params.get("qapprove") === "1";
  const queueMentions = params.get("qmention") === "1";
  const queueAssigned = params.get("qassign") === "1";
  const visibleFeed = feed.filter((site) => site.status !== "snoozed" && (showHidden || !hiddenIds.includes(site.siteId)));
  const reviewIndex = Math.min(Math.max(Number(params.get("i") || "1") - 1, 0), Math.max(visibleFeed.length - 1, 0));
  const reviewCurrent = visibleFeed[reviewIndex];
  const caughtUp = reviewing && feedLoaded && !feed.some((site) => site.status === "open");
  const ranges = rangesFromSearch(params);
  const pipelineColumns = parseColumns(params.get("cols"));
  const pillParam = params.get("pill");
  const [rememberedPill, setRememberedPill] = useState<PinLabel>("none");
  const [basemap, setBasemap] = useState<"positron" | "satellite">("positron");
  const pinLabel: PinLabel = pillParam === "asking" || pillParam === "acres" || pillParam === "peracre" || pillParam === "none"
    ? pillParam
    : rememberedPill;
  const pipelineSortId = (PIPELINE_COLUMNS.some((column) => column.id === sortParam.split(":")[0]) ? sortParam.split(":")[0] : "site") as PipelineColumnId;

  const mapArea = parseMapArea(params);
  useEffect(() => {
    setSavedSearches(readSearches());
    setShortlists(readShortlists());
    setLinkProposals(readLinks());
    setHiddenIds(readHidden());
  }, []);
  useEffect(() => {
    const stored = window.localStorage.getItem("pin-label");
    if (stored === "asking" || stored === "acres" || stored === "peracre" || stored === "none") setRememberedPill(stored);
    const base = window.localStorage.getItem("basemap");
    if (base === "satellite" || base === "positron") setBasemap(base);
  }, []);

  function setPinLabel(next: PinLabel) {
    window.localStorage.setItem("pin-label", next);
    setRememberedPill(next);
    write({ pill: next });
  }

  function chooseBasemap(next: "positron" | "satellite") {
    window.localStorage.setItem("basemap", next);
    setBasemap(next);
  }

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

  const needCatalog = allCities || Boolean(who) || query.trim().length >= 2;
  useEffect(() => {
    if (!needCatalog || catalog) return;
    let cancel = false;
    fetch("/api/data/sites").then(async (response) => {
      if (!response.ok || cancel) return;
      const payload = await response.json() as { features?: SiteFeature[] };
      if (!cancel) setCatalog(Array.isArray(payload.features) ? payload.features : []);
    }).catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [needCatalog, catalog]);

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
      const payload = (await response.json()) as { items?: { siteId: string; followed?: boolean; city?: string; reasons?: FeedSite["reasons"]; snapshot?: { name?: string; city?: string; lng?: number | null; lat?: number | null } | null }[] };
      const next = (payload.items || []).map((item) => ({
        siteId: item.siteId,
        name: item.snapshot?.name || item.siteId,
        city: item.snapshot?.city || item.city || "",
        lng: item.snapshot?.lng ?? null,
        lat: item.snapshot?.lat ?? null,
        followed: Boolean(item.followed),
        reasons: item.reasons || [],
        status: "open" as const,
        previous: null,
      }));
      setQueueCount(next.length);
      if (reviewing) {
        setFeed(next);
        setFeedLoaded(true);
      }
    }).catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [me?.actionsEnabled, reviewing, queueMarket, queueStage, queueViable, queueFresh, queueFlagged, queueApproval, queueMentions, queueAssigned]);

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
  const dealBundle = useMemo(() => {
    const rows = data?.deals.features ?? [];
    const byId = new Map<string, DealProps>();
    const byUniverse = new Map<string, DealProps>();
    for (const feature of rows) {
      byId.set(feature.properties.deal_id, feature.properties);
      if (feature.properties.universe_id && !byUniverse.has(feature.properties.universe_id)) byUniverse.set(feature.properties.universe_id, feature.properties);
    }
    return { features: rows, byId, byUniverse };
  }, [data?.deals]);

  function dealForSite(site: SiteProps) {
    if (site.linked_deal_id) {
      const linked = dealBundle.byId.get(site.linked_deal_id);
      if (linked) return linked;
    }
    return dealBundle.byUniverse.get(site.site_id);
  }

  function passesChips(site: SiteProps, loose: boolean, anyMarket = false) {
    if (!anyMarket && !allCities && site.city !== city) return false;
    if (query && !matchesQuery(query, siteSearchParts(site))) return false;
    if (loose) return true;
    if (!matchesLandTier(site, landTier)) return false;
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

  const dealFeatures = data?.deals.features ?? [];
  const dealRows = dealFeatures.map((feature) => feature.properties);
  const viewStage: StageId = allStages ? "universe" : stage;
  const localSiteMatches = query
    ? sites.filter((site) => inStage(site, viewStage) && passesChips(site, false)).length
    : 0;
  const universeWide = funnel !== "pipeline" && query.trim().length >= 2 && localSiteMatches === 0;
  const catalogSites = (catalog ?? []).filter((feature) => feature.properties.origin !== "off-market").map((feature) => presentSite(feature.properties));
  const sitePool = (universeWide || allCities) && catalogSites.length ? catalogSites : sites;
  const poolById = useMemo(() => {
    const map = new Map(featureById);
    for (const feature of catalog ?? []) map.set(feature.properties.site_id, feature);
    return map;
  }, [featureById, catalog]);

  const visibleSites = useMemo(() => {
    const byId = new Map<string, SiteProps>();
    const add = (list: SiteProps[]) => {
      for (const site of list) byId.set(site.site_id, site);
    };
    const step: StageId = allStages || universeWide ? "universe" : stage;
    const anyMarket = universeWide;
    if (compare && !universeWide) {
      add(sitePool.filter((site) => site.verdict_disagreement && passesChips(site, true, anyMarket)));
    } else if (extra === "held" && !universeWide) {
      add(sitePool.filter((site) => heldOutside(site) && passesChips(site, true, anyMarket)));
    } else if (extra === "listed" && !universeWide) {
      add(sitePool.filter((site) => (allCities || site.city === city) && inStage(site, step) && site.listed && passesChips(site, true, anyMarket)));
    } else if (extra === "contacted" && !universeWide) {
      add(sitePool.filter((site) => (allCities || site.city === city) && inStage(site, step) && site.contacted && passesChips(site, true, anyMarket)));
    } else {
      add(sitePool.filter((site) => inStage(site, step) && passesChips(site, false, anyMarket)));
      if (showDropped) add(sitePool.filter((site) => droppedAt(site, step) && passesChips(site, true, anyMarket)));
      if (landSites) add(sitePool.filter((site) => site.land_only && passesChips(site, true, anyMarket)));
    }
    return [...byId.values()].sort(compareSites);
    // passesChips closes over the chip state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, catalog, stage, city, allStages, allCities, universeWide, landTier, verdict, listed, landSites, showDropped, compare, query, extra, businessTypes, who, data?.deals]);

  const visibleFeatures: SiteFeature[] = visibleSites.flatMap((site) => {
    const feature = poolById.get(site.site_id);
    if (!feature) return [];
    if (mapArea) {
      const coords = feature.geometry?.coordinates;
      if (!coords || !inMapArea(coords[0], coords[1], mapArea)) return [];
    }
    return [{ ...feature, properties: site }];
  });

  function dealQueryHit(deal: DealProps) {
    return matchesQuery(query, dealSearchParts(deal));
  }

  function inDealMarket(deal: DealProps, wide: boolean) {
    if (wide || allCities) return true;
    const feature = dealFeatures.find((item) => item.properties.deal_id === deal.deal_id);
    const coords = feature?.geometry?.coordinates;
    return inSelectedMarket(deal, city, coords ? [coords[0], coords[1]] : null);
  }

  const localDealMatches = query
    ? dealRows.filter((deal) => {
        if (deal.kind !== "pipeline" && deal.kind !== "land") return false;
        if (!inDealMarket(deal, false)) return false;
        if (!allPipes && !who && deal.stage_group !== pipeStage) return false;
        if (who && !partyMatch(who, deal.broker, deal.firm)) return false;
        if (!typeOn(deal.business_type || "Other")) return false;
        return dealQueryHit(deal);
      }).length
    : 0;
  const pipelineWide = funnel === "pipeline" && query.trim().length >= 2 && localDealMatches === 0 && !who;
  const dealWide = pipelineWide || allPipes || Boolean(who);

  function includeDropped(group: string) {
    if (group !== "dropped") return true;
    return showDroppedDeals || dealWide || pipeStage === "dropped";
  }

  const pipelineDeals = dealRows.filter((deal) => {
    if (deal.kind !== "pipeline") return false;
    if (who && !partyMatch(who, deal.broker, deal.firm)) return false;
    if (!inDealMarket(deal, pipelineWide)) return false;
    if (!dealWide && deal.stage_group !== pipeStage) return false;
    if (!includeDropped(deal.stage_group)) return false;
    if (!typeOn(deal.business_type || "Other")) return false;
    if (query && !dealQueryHit(deal)) return false;
    return true;
  });
  const landDeals = dealRows.filter((deal) => {
    if (deal.kind !== "land") return false;
    if (who && !partyMatch(who, deal.broker, deal.firm)) return false;
    if (!inDealMarket(deal, pipelineWide)) return false;
    if (!typeOn(deal.business_type || "Other")) return false;
    if (query && !dealQueryHit(deal)) return false;
    return true;
  });

  function activityCells(id: string | undefined) {
    const touch = id ? activity[id] : undefined;
    return [touch?.lastTouched || "", touch?.materials || 0];
  }

  function exportTable() {
    const filterLine = `Filters: city ${city}, ${funnel === "pipeline" ? `pipeline ${pipeStage}` : `step ${stage}`}${query ? `, search ${query}` : ""}${landTier !== "any" ? `, tier ${landTier}` : ""}${verdict !== "any" ? `, verdict ${verdict}` : ""}${listed === "yes" ? ", listed" : ""}${businessTypes ? `, types ${businessTypes.join(" ")}` : ""}. As of ${new Date().toISOString().slice(0, 10)}.`;
    const headers = tableTab === "universe"
      ? [...siteExportHeaders(), "Last touched", "Materials"]
      : ["Deal", "Name", "City", "Stage", "Firm", "Broker", "Asking", "Asking source", "Site capacity", "Depot mi", "Universe site", "Last touched", "Materials"];
    const body = tableTab === "universe"
      ? visibleSites.map((row) => [...siteExportRow(row, dealRows), ...activityCells(row.linked_deal_id)])
      : (tableTab === "land" ? landDeals : pipelineDeals).map((row) => [
          row.deal_id, row.name, row.city, stageDetail(row.stage, row.stage_group), shownFirm(row), shownBroker(row), row.asking_price_display, shownPriceSource(row), capacitySummary(factsForDeal(row)), row.miles_to_depot, row.universe_id, ...activityCells(row.deal_id),
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

  function setCompared(id: string, on?: boolean) {
    const has = compareIds.includes(id);
    const want = on ?? !has;
    if (want === has) return;
    const next = want ? (compareIds.length >= 4 ? compareIds : [...compareIds, id]) : compareIds.filter((item) => item !== id);
    write({ compare: next.length ? next.join("|") : null });
  }

  function dealPoint(deal: DealProps): [number, number] | null {
    if (deal.universe_id) {
      const site = poolById.get(deal.universe_id);
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

  const pipelineStepRows = pipelineDeals;
  const pipelineSquares = pipelineStepRows.map(asSquare).filter((feature): feature is DealFeature => Boolean(feature));
  const stageLandRows = landDeals.filter((deal) => funnel !== "pipeline" || dealWide || deal.stage_group === pipeStage);
  const stageLandSquares = stageLandRows.map(asSquare).filter((feature): feature is DealFeature => Boolean(feature));
  const drawnDealsBase: DealFeature[] = funnel === "pipeline"
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
  const listedStepEmpty = funnel !== "pipeline" && listed === "yes" && !query && visibleSites.length === 0;
  const areaDeals = (listedStepEmpty ? [] : drawnDealsBase).filter((feature) => {
    if (funnel === "pipeline" && !matchesOpenLandTier(feature.properties.open_land_sqft, landTier)) return false;
    if (!mapArea) return true;
    const coords = feature.geometry?.coordinates;
    return coords ? inMapArea(coords[0], coords[1], mapArea) : false;
  });
  function personallyHidden(id: string) {
    if (showHidden || !hiddenIds.includes(id)) return false;
    if (selected === id) return false;
    if (query.trim().length >= 2 && matchesQuery(query, [id])) return false;
    return true;
  }
  const drawnDeals = areaDeals.filter((feature) => !personallyHidden(feature.properties.deal_id));
  const overlaysOn = parseOverlays(params.get("overlay"));
  function toggleOverlay(id: OverlayId) {
    const next = overlaysOn.includes(id) ? overlaysOn.filter((item) => item !== id) : [...overlaysOn, id];
    write({ overlay: next.length ? next.join("|") : null });
  }
  const overlayPoints = overlayFeatures(drawnDeals, overlaysOn).flatMap((feature) => {
    const coords = feature.geometry?.coordinates;
    if (!coords) return [];
    return [{ label: feature.properties.label, coordinates: [coords[0], coords[1]] as [number, number] }];
  });
  const handedOff = useRef("");
  useEffect(() => {
    if (!data || funnel === "pipeline" || listView || !listedStepEmpty) return;
    const key = `${stage}|${listed}`;
    if (handedOff.current === key) return;
    const universeListed = subcount("universe", "listed");
    const areaListed = subcount("in_area", "listed");
    const from = STEPS.find((step) => step.id === stage)?.label || "This step";
    if (stage !== "universe" && universeListed > 0) {
      handedOff.current = key;
      setHandoff(`${from} has no listed sites. Showing Universe, which has ${universeListed.toLocaleString()} listed.`);
      write({ stage: "universe", listed: "yes" });
      return;
    }
    if (stage !== "in_area" && areaListed > 0) {
      handedOff.current = key;
      setHandoff(`${from} has no listed sites. Showing In service area, which has ${areaListed.toLocaleString()} listed.`);
      write({ stage: "in_area", listed: "yes" });
    }
  }, [data, listedStepEmpty, stage, listed, funnel, listView]);
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
    setFiguresReady(false);
    fetch(`/api/data/sites/${encodeURIComponent(selected)}`).then(async (response) => {
      if (cancel) return;
      if (response.ok) setDetail(presentSite((await response.json()) as SiteProps));
      setFiguresReady(true);
    }).catch(() => {
      if (!cancel) setFiguresReady(true);
    });
    return () => {
      cancel = true;
    };
  }, [selected]);

  function choose(id: string | null) {
    setSelected(id);
    setFiguresReady(!id);
    write({ site: id }, true);
  }

  function jump(nextCity: string) {
    setSelected(null);
    write({ city: nextCity === "PHX" ? null : nextCity, site: null }, true);
  }

  function openParty(name: string) {
    const next = name.trim();
    if (!next) return;
    setSelected(null);
    write({ who: next, funnel: "pipeline", tab: "pipeline", pstage: "all", city: "all", view: "list", site: null, q: null }, true);
  }

  function filtersOn() {
    return Boolean(query || businessTypes || landTier !== "any" || verdict !== "any" || listed === "yes" || landSites || compare || showDropped);
  }

  function count(step: StageId) {
    return sitePool.filter((site) => (allCities || site.city === city) && inStage(site, step)).length;
  }

  function filteredAt(step: StageId) {
    if (compare) return sitePool.filter((site) => (allCities || site.city === city) && site.verdict_disagreement && passesChips(site, true) && inStage(site, step)).length;
    let total = sitePool.filter((site) => inStage(site, step) && passesChips(site, false)).length;
    if (landSites) total += sitePool.filter((site) => site.land_only && (allCities || site.city === city) && passesChips(site, true)).length;
    if (showDropped) total += sitePool.filter((site) => droppedAt(site, step) && passesChips(site, true)).length;
    return total;
  }

  function stepBadge(step: StageId) {
    const total = count(step);
    if (!filtersOn()) return total.toLocaleString();
    const shown = !allStages && step === stage && extra == null ? visibleSites.length : filteredAt(step);
    return `${shown.toLocaleString()} of ${total.toLocaleString()}`;
  }

  function subcount(step: StageId, field: "listed" | "contacted") {
    return sitePool.filter((site) => (allCities || site.city === city) && inStage(site, step) && site[field] && passesChips(site, false)).length;
  }

  function countLiveContactedDeals() {
    return dealRows.filter((deal) => {
      if (!isLiveContactedDeal(deal) || (!allCities && deal.city !== city)) return false;
      if (!typeOn(deal.business_type || "Other")) return false;
      if (!query) return true;
      return dealQueryHit(deal);
    }).length;
  }

  const heldCount = sites.filter((site) => site.city === city && heldOutside(site)).length;
  const censusForCity = data?.funnel.stages.find((item) => item.id === "census")?.by_city?.[city] ?? 0;

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const reviewSiteId = reviewing && !caughtUp ? reviewCurrent?.siteId : undefined;
  useEffect(() => {
    if (!reviewing || !feedLoaded) return;
    if (!reviewSiteId) {
      setSelected(null);
      return;
    }
    const deal = dealFeatures.find((feature) => feature.properties.deal_id === reviewSiteId)?.properties;
    const patch: Record<string, string | null> = { review: "1", i: String(reviewIndex + 1), site: reviewSiteId, funnel: "pipeline", tab: "pipeline", view: null, table: null };
    if (deal && (deal.city === "PHX" || deal.city === "LAS" || deal.city === "MIA")) patch.city = deal.city === "PHX" ? null : deal.city;
    if (deal && (deal.stage_group === "desk" || deal.stage_group === "contacted" || deal.stage_group === "later" || deal.stage_group === "dropped")) {
      patch.pstage = deal.stage_group === "desk" ? null : deal.stage_group;
    }
    setSelected(reviewSiteId);
    const aligned = params.get("site") === reviewSiteId
      && params.get("funnel") === "pipeline"
      && params.get("review") === "1"
      && (params.get("i") || "1") === String(reviewIndex + 1)
      && (params.get("city") || null) === (patch.city ?? null)
      && (params.get("pstage") || null) === (patch.pstage ?? null);
    if (!aligned) write(patch);
  }, [reviewing, feedLoaded, reviewSiteId, reviewIndex, dealFeatures.length, params]);

  function relatedPanel(current: { id: string; kind: "site" | "deal"; name?: string | null; address?: string | null; apn?: string | null }) {
    const records = [
      ...sites.map((site) => ({ id: site.site_id, kind: "site" as const, name: site.name, address: site.address, apn: site.apn })),
      ...dealRows.map((deal) => ({ id: deal.deal_id, kind: "deal" as const, name: deal.name, address: deal.address, apn: deal.apn })),
    ];
    const hits = relatedRecords(current, records);
    if (!hits.length) return null;
    const reviewer = me?.actionRole === "reviewer";
    const byParcel = hits.some((hit) => hit.via === "apn");
    return (
      <section className="related-records" data-testid="related-records">
        <h3>{byParcel ? "Same parcel" : "Same address"}</h3>
        <p className="note">{APPROVER_LABEL} approves before a review action changes the record. Approving a link does not rewrite Market or the workbook.</p>
        <ul>
          {hits.map((hit) => {
            const proposal = linkProposals.find((row) => (row.fromId === current.id && row.toId === hit.id) || (row.fromId === hit.id && row.toId === current.id));
            return (
              <li key={hit.id}>
                <button type="button" className="text-link" onClick={() => choose(hit.id)}>{hit.label}</button>
                <span>{hit.id} · {hit.via === "apn" ? `APN ${hit.apn}` : "same address"}</span>
                {proposal ? <span>{proposal.status === "approved" ? "Link approved" : "Link proposed"}</span> : (
                  <button type="button" onClick={() => {
                    if (!window.confirm(`Propose a link between ${current.id} and ${hit.id}? ${APPROVER_LABEL} approves before a review action changes the record.`)) return;
                    setLinkProposals(proposeLink({ fromId: current.id, toId: hit.id, via: hit.via, apn: hit.apn }));
                  }}>Propose link</button>
                )}
                {proposal && reviewer ? (
                  <button type="button" onClick={() => setLinkProposals(setLinkStatus(proposal.fromId, proposal.toId, proposal.status === "approved" ? "pending" : "approved"))}>
                    {proposal.status === "approved" ? "Reopen link" : "Approve link"}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

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

  const searchHits = collectSearchHits(
    query,
    dealRows,
    (catalog ?? features).map((feature) => feature.properties),
    (site) => deepestStage(presentSite(site as SiteProps)),
  );
  const wideCity = (pipelineWide ? pipelineDeals[0]?.city : universeWide ? visibleSites[0]?.city : "") || "";
  const focus = (pipelineWide || universeWide) && CITY_VIEW[wideCity] ? CITY_VIEW[wideCity] : (CITY_VIEW[city] ?? CITY_VIEW.PHX);
  const dropCount = sites.filter((site) => droppedAt(site, stage) && (allCities || site.city === city)).length;

  function openHit(hit: SearchHit) {
    const patch: Record<string, string | null> = { site: hit.id, who: null, q: query || null };
    if (hit.city === "PHX" || hit.city === "LAS" || hit.city === "MIA") patch.city = hit.city === "PHX" ? null : hit.city;
    if (hit.kind === "deal") {
      const known = PIPE_STEPS.some((step) => step.id === hit.stage);
      patch.funnel = "pipeline";
      patch.tab = "pipeline";
      patch.pstage = !known ? "all" : hit.stage === "desk" ? null : hit.stage;
      patch.view = listView ? "list" : null;
    } else {
      patch.funnel = null;
      patch.tab = null;
      patch.stage = !hit.stage || hit.stage === "land" ? null : hit.stage;
      patch.view = listView ? "list" : null;
    }
    setSelected(hit.id);
    write(patch, true);
  }

  function onSearchKey(event: { key: string; preventDefault: () => void }) {
    if (event.key !== "Enter" || !searchHits[0]) return;
    event.preventDefault();
    openHit(searchHits[0]);
  }

  const sheet = { expanded: sheetExpanded, onToggle: () => setSheetExpanded((value) => !value) };
  const unplacedDeals = dealRows.filter((deal) => deal.kind === "pipeline" && (allCities || deal.city === city) && !dealPoint(deal));
  const offMarketPool = universeWide && catalog ? catalog.filter((feature) => feature.properties.origin === "off-market") : offMarketFeatures;
  const offMarketShown = funnel === "pipeline" || (extra && !universeWide) ? [] : offMarketPool.filter((feature) => {
    if (!feature.geometry) return false;
    if (!(allStages || universeWide || stage === "universe") && !inStage(feature.properties, stage)) return false;
    return passesChips(feature.properties, false, universeWide);
  });
  const universePins = showUniverse ? visibleFeatures.filter((feature) => feature.geometry && !personallyHidden(feature.properties.site_id)) : [];
  const unscreenedPins = showUnscreened ? unscreened.filter((feature) => feature.properties.city === city && feature.geometry) : [];
  const pinCount = (funnel === "pipeline" ? pipelineSquares.length : universePins.length + offMarketShown.length) + unscreenedPins.length;
  const siteById = new Map([...sites, ...catalogSites].map((site) => [site.site_id, site]));

  function siteRow(site: SiteProps): ListRow {
    const price = site.listed && site.asking_price_display ? `${site.asking_price_display}${site.asking_price_source ? ` · ${site.asking_price_source}` : ""}` : "";
    return {
      id: site.site_id,
      site: site.name || site.address || site.site_id,
      type: site.business_type || "Car wash",
      city: site.city,
      stage: plainVerdict(site.verdict),
      tier: tierLabel(spareTier(site)) || "",
      spare: site.spare_ac_own != null ? `${site.spare_ac_own} ac` : "",
      grade: capacitySummary(factsForSite(site, dealForSite(site))),
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
      tier: linked ? tierLabel(spareTier(linked)) || "" : "",
      spare: linked?.spare_ac_own != null ? `${linked.spare_ac_own} ac` : "",
      grade: capacitySummary(factsForDeal(deal)),
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
      grade: "Not on file",
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
  const tierOn = (deal: DealProps) => matchesOpenLandTier(deal.open_land_sqft, landTier) && (!mapArea || (() => {
    const point = dealPoint(deal);
    return point ? inMapArea(point[0], point[1], mapArea) : false;
  })());
  const rangedPipeline = pipelineStepRows.filter((deal) => inRange(deal, ranges) && tierOn(deal));
  const landForList = showLandLayer
    ? landDeals.filter((deal) => (dealWide || deal.stage_group === pipeStage) && inRange(deal, ranges) && tierOn(deal))
    : [];
  const pipelineRows: PipelineRow[] = [...rangedPipeline, ...landForList].map((deal) => ({ deal, noPin: !dealPoint(deal) }));

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
  if (who) activeFilters.push({
    id: "who",
    label: `Broker or firm: ${who}`,
    clear: () => {
      const patch: Record<string, string | null> = { who: null };
      if (allCities) patch.city = null;
      if (allPipes) patch.pstage = null;
      write(patch);
    },
  });
  if (allCities && !who) activeFilters.push({ id: "markets", label: "All markets", clear: () => write({ city: null }) });
  if ((allStages || allPipes) && !who) activeFilters.push({ id: "all-stages", label: "All stages", clear: () => write(funnel === "pipeline" ? { pstage: null } : { stage: null }) });

  function closeMenus() {
    setFiltersOpen(false);
    setMoreOpen(false);
    setUserOpen(false);
    setMenuOpen(false);
    setUnplacedOpen(false);
  }

  function summaryText() {
    if (funnel === "pipeline") {
    const deals = dealRows.filter((deal) => deal.kind === "pipeline" && (allCities || deal.city === city));
    const land = dealRows.filter((deal) => deal.kind === "land" && (allCities || deal.city === city));
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

  function goReview(index: number) {
    const count = Math.max(visibleFeed.length, 1);
    const next = Math.min(Math.max(index, 0), count - 1);
    write({ review: "1", i: String(next + 1), view: null });
  }

  async function markCurrentReviewed() {
    if (!reviewCurrent || reviewCurrent.status === "reviewed") return;
    const response = await fetch("/api/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId: reviewCurrent.siteId }),
    });
    const payload = (await response.json().catch(() => ({}))) as { previous?: string | null };
    if (!response.ok) return;
    const previous = payload.previous ?? null;
    const siteId = reviewCurrent.siteId;
    setFeed((items) => items.map((item) => item.siteId === siteId ? { ...item, status: "reviewed", previous } : item));
    setUndo({ siteId, previous, index: reviewIndex });
    const upcoming = visibleFeed.map((item) => item.siteId === siteId ? { ...item, status: "reviewed" as const } : item);
    let next = -1;
    for (let cursor = reviewIndex + 1; cursor < upcoming.length; cursor += 1) {
      if (upcoming[cursor]?.status === "open") { next = cursor; break; }
    }
    if (next < 0) {
      for (let cursor = 0; cursor < reviewIndex; cursor += 1) {
        if (upcoming[cursor]?.status === "open") { next = cursor; break; }
      }
    }
    if (next >= 0) goReview(next);
    setQueueCount((count) => Math.max(0, count - 1));
  }

  async function undoReviewMark() {
    if (!undo) return;
    await fetch("/api/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ undo: true, siteId: undo.siteId, previous: undo.previous }),
    });
    setFeed((items) => items.map((item) => item.siteId === undo.siteId ? { ...item, status: "open" } : item));
    goReview(undo.index);
    setUndo(null);
    setQueueCount((count) => count + 1);
  }

  function snoozeCurrent() {
    if (!reviewCurrent) return;
    setFeed((items) => items.map((item) => item.siteId === reviewCurrent.siteId ? { ...item, status: "snoozed" } : item));
  }

  const filterBits = [marketLabel(queueMarket)];
  if (queueApproval) filterBits.push("Needs my approval");
  if (queueMentions) filterBits.push("Mentions");
  if (queueAssigned) filterBits.push("Assigned to me");
  if (queueFresh) filterBits.push("New sites");
  if (queueFlagged) filterBits.push("Flagged to me");
  if (queueViable) filterBits.push("Active");
  const filterSummary = filterBits.join(" · ");
  const reviewPoint = reviewCurrent ? dealRows.find((deal) => deal.deal_id === reviewCurrent.siteId) : undefined;
  const reviewFromDeal = reviewPoint ? dealPoint(reviewPoint) : null;
  const reviewCoords = reviewFromDeal
    || (reviewCurrent?.lng != null && reviewCurrent.lat != null ? [reviewCurrent.lng, reviewCurrent.lat] as [number, number] : null);
  const reviewMarket = reviewCurrent && (reviewCurrent.city === "PHX" || reviewCurrent.city === "LAS" || reviewCurrent.city === "MIA") ? reviewCurrent.city : city;
  const reviewFocus = reviewing && reviewCurrent
    ? (reviewCoords
      ? { lng: reviewCoords[0], lat: reviewCoords[1], zoom: 15.5 }
      : { lng: (CITY_VIEW[reviewMarket] ?? CITY_VIEW.PHX).center[0], lat: (CITY_VIEW[reviewMarket] ?? CITY_VIEW.PHX).center[1], zoom: (CITY_VIEW[reviewMarket] ?? CITY_VIEW.PHX).zoom })
    : null;
  const reviewMarkers = reviewing ? visibleFeed.flatMap((site, index) => {
    const deal = dealRows.find((row) => row.deal_id === site.siteId);
    const point = (deal ? dealPoint(deal) : null) || (site.lng != null && site.lat != null ? [site.lng, site.lat] as [number, number] : null);
    if (!point) return [];
    return [{ id: site.siteId, lng: point[0], lat: point[1], n: index + 1, current: site.siteId === reviewCurrent?.siteId }];
  }) : [];

  return (
    <div ref={bindShell} className={`shell ${tableOpen ? "table-open" : ""} ${listView ? "list-open" : ""} ${selected ? "drawer-open" : ""} ${reviewing ? "reviewing" : ""} ${filtersOpen ? "filters-open" : ""}`} data-visible={visibleSites.length} data-city={allCities ? "all" : city} data-stage={allStages ? "all" : stage} data-pin-count={pinCount} data-list-count={funnel === "pipeline" ? pipelineRows.length : listRows.length}>
      {(filtersOpen || moreOpen || userOpen || menuOpen || unplacedOpen) ? (
        <button className="backdrop" type="button" aria-label="Close menu" onClick={closeMenus} />
      ) : null}
      <header className="bar">
        <div className="top">
          <Wordmark view={tableOpen ? "list" : "map"} />
          <div className="cities only-desktop" role="group" aria-label="City">
            {CITIES.map((item) => (
              <button key={item} className={!allCities && city === item ? "on" : ""} type="button" onClick={() => jump(item)}>
                {item === "PHX" ? "Phoenix" : item === "LAS" ? "Las Vegas" : "Miami"}
              </button>
            ))}
          </div>
          <label className="city-pick only-mobile">
            <span className="sr">City</span>
            <select aria-label="City" value={allCities ? "all" : city} onChange={(event) => jump(event.target.value)}>
              <option value="all">All markets</option>
              <option value="PHX">Phoenix</option>
              <option value="LAS">Las Vegas</option>
              <option value="MIA">Miami</option>
            </select>
          </label>
          <input className="search only-desktop" aria-label="Search" placeholder="Name, address, broker, APN, id" value={query} onChange={(event) => write({ q: event.target.value || null })} onKeyDown={onSearchKey} />
          <div className="funnel-switch only-desktop" role="group" aria-label="Which funnel">
            <button className={funnel === "universe" ? "on" : ""} type="button" onClick={() => write({ funnel: null, tab: null })}>Universe</button>
            <button className={funnel === "pipeline" ? "on" : ""} type="button" onClick={() => write({ funnel: "pipeline", tab: "pipeline" })}>Pipeline</button>
          </div>
          <div className="funnel-switch map-switch only-desktop" role="group" aria-label="Map or list">
            <button className={!listView && !reviewing ? "on" : ""} type="button" onClick={() => write({ view: null, review: null, i: null })}>Map</button>
            <button className={listView && !reviewing ? "on" : ""} type="button" onClick={() => write({ view: "list", review: null, i: null })}>List</button>
          </div>
          {me?.actionsEnabled ? (
            <button className={`review-launch ${reviewing ? "on" : ""}`} type="button" onClick={() => write({ review: reviewing ? null : "1", i: reviewing ? null : "1", view: null, table: null })}>
              Review{queueCount ? <span className="count-badge" data-testid="queue-count">{queueCount}</span> : null}
            </button>
          ) : null}
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
        <div className="funnel-switch only-mobile" role="group" aria-label="Map or list">
          <button className={!listView && !reviewing ? "on" : ""} type="button" onClick={() => write({ view: null, review: null, i: null })}>Map</button>
          <button className={listView && !reviewing ? "on" : ""} type="button" onClick={() => write({ view: "list", review: null, i: null })}>List</button>
        </div>
        <div className="funnel-switch only-mobile" role="group" aria-label="Which funnel">
          <button className={funnel === "universe" ? "on" : ""} type="button" onClick={() => write({ funnel: null, tab: null })}>Universe</button>
          <button className={funnel === "pipeline" ? "on" : ""} type="button" onClick={() => write({ funnel: "pipeline", tab: "pipeline" })}>Pipeline</button>
          <button className={filtersOpen ? "on" : ""} type="button" onClick={() => { setFiltersOpen((value) => !value); setMenuOpen(false); }}>Filters{activeFilters.length ? ` (${activeFilters.length})` : ""}</button>
        </div>
        {searchOpen ? (
          <input className="search mobile-search" aria-label="Search" placeholder="Name, address, broker, APN, id" value={query} onChange={(event) => write({ q: event.target.value || null })} onKeyDown={onSearchKey} />
        ) : null}
        {query.trim().length >= 2 ? (
          <div className="search-hits" role="listbox" aria-label="Search results" data-testid="search-hits">
            {universeWide || pipelineWide ? (
              <div className="search-wide" data-testid="search-wide">
                <p className="search-note">No matches in this view. Showing matches from every stage and market.</p>
                <p className="search-note search-wide-warn">The 0 on this step is this view only. Matches below are from other steps or markets, so the site can still be on the map.</p>
              </div>
            ) : null}
            {searchHits.length ? searchHits.map((hit) => (
              <button key={`${hit.kind}-${hit.id}`} type="button" role="option" onClick={() => openHit(hit)}>
                <span className="hit-title">{hit.title}</span>
                <span className="hit-address">{hit.address || "Address not on file"}</span>
                <span className="hit-id">{hit.id}</span>
                <span className="hit-meta">{[marketName(hit.city), hit.kind === "deal" ? stageTitle(hit.stage) : (STEPS.find((step) => step.id === hit.stage)?.label || "Universe")].filter(Boolean).join(" · ")}</span>
              </button>
            )) : <p className="search-note">No matches.</p>}
          </div>
        ) : null}
        <div className="funnel-row">
          <nav className={funnel === "pipeline" ? "funnel compact" : "funnel"} aria-label="Funnel">
            {funnel === "universe" ? (
              <>
                <span className="step">
                  <button className={allStages && !extra ? "on" : ""} type="button" data-testid="all-stages" aria-current={allStages && !extra ? "step" : undefined} title="Every site in this market, at every step." onClick={() => write({ stage: allStages ? null : "all", extra: null, ruled: null }, true)}>
                    <span>All</span>
                    <strong>{sitePool.filter((site) => (allCities || site.city === city) && inStage(site, "universe") && passesChips(site, false)).length.toLocaleString()}</strong>
                  </button>
                </span>
                <span className="chev" aria-hidden="true">›</span>
              </>
            ) : (
              <>
                <span className="step">
                  <button className={allPipes ? "on" : ""} type="button" data-testid="all-stages" aria-current={allPipes ? "step" : undefined} title="Every deal in this market, at every stage." onClick={() => write({ pstage: allPipes ? null : "all" }, true)}>
                    <span>All</span>
                    <strong>{dealRows.filter((deal) => {
                      if (deal.kind !== "pipeline" && deal.kind !== "land") return false;
                      if (!allCities && deal.city !== city) return false;
                      if (who && !partyMatch(who, deal.broker, deal.firm)) return false;
                      if (!typeOn(deal.business_type || "Other")) return false;
                      if (query && !dealQueryHit(deal)) return false;
                      return true;
                    }).length.toLocaleString()}</strong>
                  </button>
                </span>
                <span className="chev" aria-hidden="true">›</span>
              </>
            )}
            {funnel === "universe" ? STEPS.map((step, index) => {
              const listedHere = subcount(step.id, "listed");
              const dealsContacted = step.id === "universe" ? countLiveContactedDeals() : 0;
              const note = step.id === "universe"
                ? `Built from ${censusForCity.toLocaleString()} census records. The count keeps the rows the workbook includes.`
                : FUNNEL_NOTES[step.id];
              return (
                <Fragment key={step.id}>
                  {index > 0 ? <span className="chev" aria-hidden="true">›</span> : null}
                  <span className="step">
                    <button className={!allStages && !universeWide && stage === step.id && extra !== "listed" && extra !== "contacted" ? "on" : ""} type="button" aria-current={!allStages && !universeWide && stage === step.id && !extra ? "step" : undefined} title={note} onMouseEnter={() => setTip(note)} onMouseLeave={() => setTip("")} onClick={() => write({ stage: step.id === "land" ? null : step.id, extra: null, ruled: null }, true)}>
                      <span>{step.label}</span>
                      <strong data-count={!allStages && step.id === stage && extra == null ? visibleSites.length : filteredAt(step.id)}>{stepBadge(step.id)}</strong>
                    </button>
                    {listedHere > 0 ? (
                      <button className={`sub ${extra === "listed" && stage === step.id ? "on" : ""}`} type="button" title={FUNNEL_NOTES.listed} onMouseEnter={() => setTip(FUNNEL_NOTES.listed)} onMouseLeave={() => setTip("")} onClick={() => write({ stage: step.id === "land" ? null : step.id, extra: extra === "listed" ? null : "listed" })}>
                        {listedHere.toLocaleString()} listed
                      </button>
                    ) : null}
                    {dealsContacted > 0 ? (
                      <button className="sub" type="button" data-testid="deals-contacted" title={FUNNEL_NOTES.contacted} onMouseEnter={() => setTip(FUNNEL_NOTES.contacted)} onMouseLeave={() => setTip("")} onClick={() => setTip(FUNNEL_NOTES.contacted)}>
                        {dealsContacted.toLocaleString()} deals contacted
                      </button>
                    ) : null}
                  </span>
                </Fragment>
              );
            }) : PIPE_STEPS.map((step, index) => {
              const rows = dealRows.filter((deal) => {
                if (deal.kind !== "pipeline" || deal.stage_group !== step.id) return false;
                if (!allCities && deal.city !== city) return false;
                if (!typeOn(deal.business_type || "Other")) return false;
                if (who && !partyMatch(who, deal.broker, deal.firm)) return false;
                if (!query) return true;
                return dealQueryHit(deal);
              });
              const landHere = dealRows.filter((deal) => {
                if (deal.kind !== "land" || deal.stage_group !== step.id) return false;
                if (!allCities && deal.city !== city) return false;
                if (!typeOn(deal.business_type || "Other")) return false;
                if (who && !partyMatch(who, deal.broker, deal.firm)) return false;
                if (!query) return true;
                return dealQueryHit(deal);
              });
              const total = rows.length + landHere.length;
              const unmapped = [...rows, ...landHere].filter((deal) => !dealPoint(deal)).length;
              const brokerHere = [...rows, ...landHere].filter((deal) => deal.broker_contacted).length;
              const split = landHere.length > 0 ? ` (${rows.length.toLocaleString()} deals, ${landHere.length.toLocaleString()} land)` : "";
              return (
                <Fragment key={step.id}>
                  {index > 0 ? <span className="chev" aria-hidden="true">›</span> : null}
                  <span className="step">
                    <button className={!allPipes && !pipelineWide && pipeStage === step.id ? "on" : ""} type="button" aria-current={!allPipes && !pipelineWide && pipeStage === step.id ? "step" : undefined} title={`${FUNNEL_NOTES[step.id]}${brokerHere ? ` ${brokerHere.toLocaleString()} deals contacted.` : ""}`} onMouseEnter={() => setTip(`${FUNNEL_NOTES[step.id]}${brokerHere ? ` ${brokerHere.toLocaleString()} deals contacted.` : ""}`)} onMouseLeave={() => setTip("")} onClick={() => write({ pstage: step.id === "desk" ? null : step.id }, true)}>
                      <span>{step.label}</span>
                      <strong>{total.toLocaleString()}</strong>
                      {split ? <span className="split">{split}</span> : null}
                    </button>
                    {!allPipes && pipeStage === step.id && unmapped > 0 ? <span className="sub">{unmapped.toLocaleString()} without a location</span> : null}
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
                const inStep = sitePool.filter((site) => (allCities || site.city === city) && inStage(site, allStages ? "universe" : stage) && (site.business_type || "Car wash") === type).length;
                const offCount = offMarketFeatures.filter((feature) => (feature.properties.business_type || "Other") === type).length;
                const shown = funnel === "pipeline"
                  ? pipelineDeals.filter((deal) => (deal.business_type || "Other") === type && Boolean(dealPoint(deal))).length
                  : inStep || offCount;
                if (shown === 0 && type !== "Car wash") return null;
                return (
                  <button key={type} type="button" title={type === "Car wash" ? CENSUS_NOTE : undefined} className={typeOn(type) && businessTypes !== null ? "on" : businessTypes === null ? "on" : ""} onClick={() => toggleType(type)}>
                    {type} {shown.toLocaleString()}
                  </button>
                );
              })}
            </div>
            <h3>Broker or firm</h3>
            <input
              className="party-filter"
              aria-label="Broker or firm"
              placeholder="Name or firm"
              value={who}
              onChange={(event) => {
                const next = event.target.value;
                if (!next.trim()) {
                  write({ who: null });
                  return;
                }
                write({ who: next, funnel: "pipeline", tab: "pipeline", pstage: "all", city: "all", view: "list" });
              }}
            />
            <h3>Spare land</h3>
            <div className="chips">
              {(["any", "L10", "L4"] as const).map((item) => (
                <button key={item} className={landTier === item ? "on" : ""} type="button" title={item === "any" ? "" : TIER_NOTES[item].note} onMouseEnter={() => item !== "any" && setTip(TIER_NOTES[item].note)} onMouseLeave={() => setTip("")} onClick={() => write({ tier: item === "any" ? null : item })}>
                  {item === "any" ? "All tiers" : <><i className={`swatch ${item === "L10" ? "l10" : "l4"}`} /> {TIER_NOTES[item].label}</>}
                </button>
              ))}
            </div>
            <h3>Saved searches</h3>
            <form className="saved-search" onSubmit={(event) => {
              event.preventDefault();
              setSavedSearches(saveSearch(searchName, window.location.search.replace(/^\?/, "")));
              setSearchName("");
            }}>
              <input aria-label="Saved search name" placeholder="Name this search" value={searchName} onChange={(event) => setSearchName(event.target.value)} maxLength={80} />
              <button type="submit">Save search</button>
            </form>
            {savedSearches.length ? (
              <ul className="saved-list">
                {savedSearches.map((item) => (
                  <li key={item.name}>
                    <button type="button" onClick={() => { window.location.assign(item.query ? `/?${item.query}` : "/"); }}>{item.name}</button>
                    <button type="button" onClick={() => setSavedSearches(removeSearch(item.name))}>Remove</button>
                  </li>
                ))}
              </ul>
            ) : <p className="note">No saved searches yet.</p>}
            {funnel === "universe" ? (
              <>
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
            <button type="button" onClick={() => { write({ view: listView ? null : "list", review: null, i: null }); setMenuOpen(false); }}>{listView ? "Map" : "List"}</button>
            {me?.actionsEnabled ? (
              <button type="button" onClick={() => { write({ review: "1", i: "1", view: null, table: null }); setMenuOpen(false); }}>Review{queueCount ? ` (${queueCount})` : ""}</button>
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
      {reviewing && me?.actionsEnabled ? (
        <ReviewBar
          index={reviewIndex}
          total={visibleFeed.length}
          reviewed={feed.filter((site) => site.status === "reviewed").length}
          summary={filterSummary}
          siteId={reviewCurrent?.siteId || ""}
          followed={Boolean(reviewCurrent?.followed)}
          onPrev={() => goReview(reviewIndex - 1)}
          onNext={() => goReview(reviewIndex + 1)}
          onReviewed={() => void markCurrentReviewed()}
          onExit={() => write({ review: null, i: null })}
          onOpenFeed={() => setFeedSheet(true)}
          onSnooze={snoozeCurrent}
          filters={(
            <FilterPopover
              summary={filterSummary}
              market={queueMarket}
              stage={queueStage}
              viable={queueViable}
              freshOnly={queueFresh}
              flaggedOnly={queueFlagged}
              approvalOnly={queueApproval}
              mentionsOnly={queueMentions}
              assignedOnly={queueAssigned}
              onFilter={(patch) => {
                const next = { ...patch, review: "1", i: "1" };
                if ("qmarket" in next && next.qmarket === city) next.qmarket = null;
                write(next);
              }}
            />
          )}
        />
      ) : null}

      <div className="map-stage">
        <ActionsDialogs />
        {reviewing && !caughtUp ? (
          <ReviewRail sites={visibleFeed} currentId={reviewCurrent?.siteId || ""} onPick={goReview} />
        ) : null}
        {caughtUp ? (
          <div className="review-done" data-testid="queue-empty">
            <p>All caught up</p>
            <button type="button" onClick={() => write({ review: null, i: null })}>Back to map</button>
          </div>
        ) : null}
        {reviewing && reviewCurrent && !reviewCoords ? <p className="review-noloc" data-testid="review-noloc">No exact location yet</p> : null}
        {undo ? (
          <div className="review-toast" role="status">
            Marked reviewed.
            <button type="button" onClick={() => void undoReviewMark()}>Undo</button>
          </div>
        ) : null}
        {feedSheet ? (
          <ReviewFeedSheet sites={visibleFeed} currentId={reviewCurrent?.siteId || ""} onPick={goReview} onClose={() => setFeedSheet(false)} />
        ) : null}
        <MapView
          sites={funnel === "pipeline" ? (showUniverse ? pipelineSites : []) : (showUniverse ? visibleFeatures : [])}
          coverage={funnel !== "pipeline" && showUniverse ? {
            listed: visibleFeatures.length,
            missingPoint: visibleFeatures.filter((feature) => !feature.geometry).length,
          } : null}
          deals={drawnDeals}
          fitPoints={[
            ...((funnel === "pipeline" ? [] : visibleFeatures).flatMap((feature) => feature.geometry ? [feature.geometry.coordinates as [number, number]] : [])),
            ...drawnDeals.flatMap((feature) => feature.geometry ? [feature.geometry.coordinates as [number, number]] : []),
          ]}
          area={mapArea}
          onArea={(next) => write(areaQuery(next))}
          overlayPoints={overlayPoints}
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
          reviewMarkers={reviewMarkers}
          reviewFocus={reviewFocus}
          pinLabel={pinLabel}
          onPinLabel={setPinLabel}
          basemap={basemap}
          onBasemap={chooseBasemap}
          onSelect={(id) => {
            if (reviewing) {
              const at = visibleFeed.findIndex((site) => site.siteId === id);
              if (at >= 0) {
                goReview(at);
                return;
              }
            }
            if (dealRows.some((deal) => deal.deal_id === id)) setTableTab(dealRows.find((deal) => deal.deal_id === id)?.kind === "land" ? "land" : "pipeline");
            choose(id);
          }}
          onBounds={() => undefined}
        />
        <div className="overlay-bar" role="group" aria-label="Workbook overlays">
          {OVERLAYS.map((item) => (
            <button key={item.id} type="button" className={overlaysOn.includes(item.id) ? "on" : ""} onClick={() => toggleOverlay(item.id)}>
              {item.label}
            </button>
          ))}
          <span className="overlay-note">Scan only. A blank cell stays off the layer. Sites under 20,000 vehicles/day or 25,000 people stay on the map.</span>
          {hiddenIds.length ? (
            <button type="button" onClick={() => { setHiddenIds(clearHidden()); setShowHidden(false); }}>
              Clear {hiddenIds.length} hidden
            </button>
          ) : null}
        </div>
        {handoff ? <p className="empty-map" role="status">{handoff}</p> : null}
        {funnel === "universe" && !listView && visibleFeatures.length === 0 ? (
          <p className="empty-map">{listedStepEmpty
            ? `${STEPS.find((step) => step.id === stage)?.label || "This step"} has no listed sites. Universe has ${subcount("universe", "listed").toLocaleString()} listed. In service area has ${subcount("in_area", "listed").toLocaleString()} listed.`
            : compare ? `No disagreements in ${city === "PHX" ? "Phoenix" : city === "LAS" ? "Las Vegas" : "Miami"}.` : query ? "No matches." : "Nothing to show for this step."}</p>
        ) : null}
        {listedStepEmpty && !listView ? (
          <div className="empty-actions">
            <button type="button" onClick={() => write({ stage: "universe", listed: "yes" })}>Show Universe listed</button>
            <button type="button" onClick={() => write({ stage: "in_area", listed: "yes" })}>Show in service area listed</button>
          </div>
        ) : null}
        {!listView ? (() => {
          const missing = funnel === "pipeline"
            ? pipelineStepRows.length - pipelineSquares.length
            : visibleSites.filter((site) => !featureById.get(site.site_id)?.geometry).length + (landSites ? landDeals.filter((deal) => !dealPoint(deal)).length : 0);
          return missing > 0 ? <p className="location-note">{missing.toLocaleString()} without a location</p> : null;
        })() : null}
        {listView && funnel === "pipeline" ? (
          <PipelineList
            rows={pipelineRows}
            columns={pipelineColumns}
            selectedId={selected}
            compareIds={compareIds}
            sort={{ id: pipelineSortId, desc: sortDesc }}
            ranges={ranges}
            onSort={(id) => write({ sort: `${id}:${pipelineSortId === id && !sortDesc ? "desc" : "asc"}` })}
            onOpen={choose}
            onShowMap={(id) => { setSelected(id); write({ view: null, site: id }); }}
            onCompare={(id, on) => setCompared(id, on)}
            onColumns={(next) => {
              const all = PIPELINE_COLUMNS.map((column) => column.id).join(",");
              const value = next.join(",");
              write({ cols: value === all ? null : value });
            }}
            onResetColumns={() => write({ cols: null })}
            onRanges={(next) => write(rangeQuery(next))}
          />
        ) : listView ? (
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
            <p>Site capacity sits beside spare land. It lists the measured facts on file, with the source and confidence for each. A blank layer stays blank.</p>
            <p>Deals contacted, beside Universe, counts Pipeline and Land deals in this city with an outbound email or call on file. Dropped deals stay out of that count.</p>
            <p>Held sites are cleared on the land, but they sit outside the current service area. They are not counted in the in-area steps.</p>
            <ul>
              {STATUS_NOTES.map((item) => <li key={item.id}><strong>{item.label}.</strong> {item.note}</li>)}
            </ul>
          </aside>
        ) : null}
        {selectedDeal ? (
          <DealDetail
            deal={selectedDeal}
            peers={dealRows.filter((deal) => deal.city === selectedDeal.city && deal.kind === selectedDeal.kind)}
            universeSite={selectedDeal.universe_id ? siteById.get(selectedDeal.universe_id) : null}
            universeName={siteById.get(selectedDeal.universe_id)?.name}
            depotMiles={selectedDeal.miles_to_depot}
            lng={dealPoint(selectedDeal)?.[0]}
            lat={dealPoint(selectedDeal)?.[1]}
            onOpenSite={selectedDeal.universe_id ? () => choose(selectedDeal.universe_id) : undefined}
            onOpenParty={openParty}
            onClose={() => choose(null)}
            onCompare={(on) => setCompared(selectedDeal.deal_id, on)}
            onNotFit={() => { setHiddenIds(hideSite(selectedDeal.deal_id)); choose(null); }}
            compared={compareIds.includes(selectedDeal.deal_id)}
            sheet={sheet}
            banner={reviewing && reviewCurrent?.siteId === selectedDeal.deal_id ? <WhatChanged reasons={reviewCurrent.reasons} /> : null}
            onSwipe={reviewing ? (direction) => goReview(direction === "next" ? reviewIndex + 1 : reviewIndex - 1) : undefined}
            extras={<RecordActions kind="deal" id={selectedDeal.deal_id} />}
            figuresReady={Boolean(selectedDeal) || figuresReady}
            related={relatedPanel({ id: selectedDeal.deal_id, kind: "deal", name: selectedDeal.name, address: selectedDeal.address, apn: selectedDeal.apn || siteById.get(selectedDeal.universe_id)?.apn })}
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
            onOpenParty={openParty}
            onAddCompare={() => setCompared(selectedSite.site_id, !compareIds.includes(selectedSite.site_id))}
            onNotFit={() => { setHiddenIds(hideSite(selectedSite.site_id)); choose(null); }}
            sameOwner={sites.filter((site) => site.site_id !== selectedSite.site_id && site.owner && site.owner === selectedSite.owner).slice(0, 6)}
            onClose={() => choose(null)}
            sheet={sheet}
            extras={<RecordActions kind="site" id={selectedSite.site_id} />}
            figuresReady={figuresReady}
            related={relatedPanel({ id: selectedSite.site_id, kind: "site", name: selectedSite.name, address: selectedSite.address, apn: selectedSite.apn })}
          />
        ) : null}
        {compareIds.length ? (
          <CompareTray
            deals={compareIds.flatMap((id) => {
              const deal = dealRows.find((item) => item.deal_id === id);
              return deal ? [deal] : [];
            })}
            sites={compareIds.flatMap((id) => {
              if (dealRows.some((item) => item.deal_id === id)) return [];
              const site = sites.find((item) => item.site_id === id);
              return site ? [site] : [];
            })}
            contextSites={sites}
            onRemove={(id) => setCompared(id, false)}
            onClose={() => write({ compare: null, slist: null })}
          >
            {compareIds.length >= 2 ? (
              <form className="shortlist-save" onSubmit={(event) => {
                event.preventDefault();
                const next = saveShortlist(listName, compareIds);
                setShortlists(next);
                write({ slist: listName.trim() || null });
                setListName("");
              }}>
                <input aria-label="Shortlist name" placeholder="Name this shortlist" value={listName} onChange={(event) => setListName(event.target.value)} maxLength={80} />
                <button type="submit">Save shortlist</button>
                {shortlists.map((item) => (
                  <button key={item.name} type="button" onClick={() => write({ compare: item.ids.join("|"), slist: item.name })}>{item.name}</button>
                ))}
                {params.get("slist") ? <button type="button" onClick={() => setShortlists(removeShortlist(params.get("slist") || ""))}>Remove {params.get("slist")}</button> : null}
              </form>
            ) : null}
          </CompareTray>
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
          {tableTab === "universe" ? <SiteTable rows={visibleSites} deals={dealRows} selectedId={selected} onSelect={choose} activity={activity} sorting={sortParam ? [{ id: sortParam.split(":")[0], desc: sortParam.endsWith(":desc") }] : []} onSortingChange={(next) => write({ sort: next[0] ? `${next[0].id}:${next[0].desc ? "desc" : "asc"}` : null })} /> : null}
          {tableTab === "pipeline" ? <DealTable rows={pipelineDeals} selectedId={selected} onSelect={choose} activity={activity} /> : null}
          {tableTab === "land" ? <DealTable rows={landDeals} selectedId={selected} onSelect={choose} activity={activity} /> : null}
        </section>
      ) : null}
    </div>
  );
}
