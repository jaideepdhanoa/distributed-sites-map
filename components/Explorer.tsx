"use client";

import dynamic from "next/dynamic";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { ActionsDialogs, ActionsMenuButtons } from "./actions/ActionsChrome";
import { FilterPopover, ReviewBar, ReviewFeedSheet, ReviewRail, marketLabel, type FeedSite } from "./queue/QueueView";
import { AskPanel } from "./agent/AskPanel";
import { RecordActions } from "./actions/RecordActions";
import Detail, { DealDetail, UnscreenedDetail } from "./Detail";
import { PanelBoundary } from "./PanelBoundary";
import Wordmark from "./Wordmark";
import ListView, { LIST_COLUMNS, listCsv, type ListRow } from "./ListView";
import PipelineList, { type PipelineRow } from "./PipelineList";
import CompareTray from "./CompareTray";
import SiteTable, { DealTable, type ActivitySummary } from "./SiteTable";
import { actionsDown, quietActionsFetch, subscribeActionsDown } from "@/lib/actions/quiet";
import { DRAWER_DEFAULT, DRAWER_WIDTH_KEY, clampDrawerWidth } from "@/lib/drawerWidth";
import { initialSheetSnap, stepSheet, type SheetSnap } from "@/lib/sheetSnap";
import { CITY_VIEW, CITIES, compareSites, droppedAt, heldOutside, inSelectedMarket, inStage, isLiveContactedDeal, matchesLandTier, matchesOpenLandTier, nearestDepot, presentSite, spareTier, type PipeId, type StageId } from "@/lib/filter";
import { areaQuery, inMapArea, parseMapArea, type MapArea } from "@/lib/geoFilter";
import { isProtectedId, omitProtectedSites } from "@/lib/protectedSite";
import { relatedRecords } from "@/lib/related";
import { readSearches, readShortlists, removeSearch, removeShortlist } from "@/lib/savedSets";
import { OVERLAYS, overlayFeatures, parseOverlays, type OverlayId } from "@/lib/overlays";
import { displayAddress, folderHref, leadSourceLine, listingHref } from "@/lib/format";
import { dealSearchParts, matchesQuery, partyMatch, siteSearchParts } from "@/lib/search";
import { paletteGroups } from "@/lib/search/palette";
import { PIPELINE_COLUMNS, capacitySummary, defaultColumnIds, displayScore, factsForDeal, factsForSite, inRange, parseColumns, rangeQuery, rangesFromSearch, vehiclesPerDay, type PinLabel, type PipelineColumnId } from "@/lib/keyNumbers";
import { categorySearch, dealCategory, dealInCategories, isLandParcelSite, landLinks, parseCategories, siteCategory, siteInCategories, type CategoryId } from "@/lib/categories";
import { CATEGORY_NOTES, FUNNEL_NOTES, LAYER_TITLES, QUICK_LUBE_LABEL, SPARE_LAND_NOTE, STATUS_NOTES, SUMMARY_NOTES, UNSCREENED_LISTINGS_LABEL, UNSCREENED_LISTINGS_NOTE, isPipelineStore, plainVerdict, stageDetail, stageTitle, tierLabel } from "@/lib/labels";
import { nearbyWashPoints, type WashSite } from "@/lib/nearbyWashes";
import { FUNNEL_STORAGE, FUNNEL_VERSION, FUNNEL_VERSION_KEY, resolveFunnelMode, type FunnelMode } from "@/lib/funnelMode";
import { MARKET_STORAGE, MARKET_VERSION, MARKET_VERSION_KEY, marketFocus, marketSearchValue, type MarketId } from "@/lib/marketView";
import { PIN_LABEL_STORAGE, PIN_LABEL_VERSION, PIN_LABEL_VERSION_KEY, resolvePinLabel } from "@/lib/pinLabel";
import { pipelineAllCount, pipelineMapSummary } from "@/lib/mapSummary";
import { inCountedMarket, labeledCount, marketCounts, reviewBadge, stepParts } from "@/lib/counts";
import { scoreIssue } from "@/lib/scoreDisplay";
import type { SpaceShape } from "./spaces/SpacePopover";
import { siteSpaceChange } from "@/lib/spaces/change";
import CommentGridHost from "./comments/CommentGridHost";
import { COMMENT_CHANGED, COMMENT_OPEN, readCommentAnchor } from "@/lib/comments/nav";
import type { GroundBox } from "@/lib/spaces/measure";
import type { SpaceLayout, SpaceType } from "@/lib/spaces/vocab";
import { patchLiveStage, preservePendingStage, STAGE_REFRESH_EVENT, type StageRefresh } from "@/lib/stageOverlay";
import { linkedPnlIds, linksFromRecords } from "@/lib/pnl/ids";
import { placeReadableTip } from "@/lib/tipPlace";
import { droppedDealsShown, parsePipeView } from "@/lib/pipeStage";
import AlertSettings from "./alerts/AlertSettings";
import CommandSearch from "./CommandSearch";
import "@/app/alerts.css";
import type { AppData, DealFeature, DealProps, GeoFeature, SiteFeature, SiteProps, UnscreenedFeature, UnscreenedProps } from "@/lib/types";
import { ndaChip, ndaQueueAllowed } from "@/lib/nda";
import { NEAR_TIP, serviceAreaChip, serviceAreaShort } from "@/lib/cardStatus";
import { canWrite } from "./actions/panel";
import type { ActionRole } from "@/lib/actions/roles";
import { currentSearch, rememberSearch } from "@/lib/navSearch";
import { countDroppedDeals, countOutsideServiceArea, dealOnPipeStep, inReach, outsideServiceArea, parseReach, reachLabel, serviceAreaSplit, type Reach } from "@/lib/reach";
import { NdaChip } from "./NdaChip";
import NdaQueue from "./NdaQueue";
import OpenLoops from "./OpenLoops";

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
  { id: "in_area", label: "Service area" },
  { id: "land", label: "Open land" },
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

function ActionsQuietNotice() {
  const down = useSyncExternalStore(subscribeActionsDown, actionsDown, () => false);
  if (!down) return null;
  return <p className="actions-quiet" role="status">Discussion is unavailable on this preview.</p>;
}

function pointOf(point?: [number, number] | null): { lng?: number; lat?: number } {
  if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return {};
  return { lng: point[0], lat: point[1] };
}

function guardFeatures<T extends { features?: { properties?: Record<string, unknown> | null }[] }>(body: T): T {
  if (!body.features) return body;
  const features = body.features.filter((feature) => {
    const props = feature.properties || {};
    const linked = props.linked_deal_ids;
    const ids = [props.deal_id, props.site_id, props.linked_deal_id];
    if (ids.some((id) => typeof id === "string" && isProtectedId(id))) return false;
    return !(Array.isArray(linked) && linked.some((id) => typeof id === "string" && isProtectedId(id)));
  });
  return { ...body, features };
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
  const appleShortcut = useSyncExternalStore(
    () => () => undefined,
    () => /Mac|iPhone|iPad|iPod/.test(navigator.platform) || /Mac OS|iPhone|iPad/.test(navigator.userAgent),
    () => false,
  );
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
    const layers = shell.querySelector(".layers");
    if (!layers) return;
    const width = Math.ceil(layers.getBoundingClientRect().width);
    shell.style.setProperty("--layers-clear", `${Math.max(width, 1) + 22}px`);
  });
  const [data, setData] = useState<AppData | null>(null);
  const [activity, setActivity] = useState<ActivitySummary>({});
  const [unscreened, setUnscreened] = useState<UnscreenedFeature[]>([]);
  const [detail, setDetail] = useState<SiteProps | null>(null);
  const [me, setMe] = useState<{ u: string; role: string; actionRole?: string; actionsEnabled?: boolean } | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [askSite, setAskSite] = useState<{ id: string; name: string } | null>(null);
  const [figuresReady, setFiguresReady] = useState(!params.get("site"));
  const [handoff, setHandoff] = useState("");
  const [gridFeatures, setGridFeatures] = useState<GeoFeature[]>([]);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const [queueTick, setQueueTick] = useState(0);
  const [feed, setFeed] = useState<FeedSite[]>([]);
  const [feedLoaded, setFeedLoaded] = useState(false);
  const [loadedQueueKey, setLoadedQueueKey] = useState("");
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
  const pinsOn = params.get("pins") !== "0";
  const dealsOn = params.get("deals") !== "0";
  const showUnscreened = params.get("newlist") === "1";
  const showDroppedDeals = params.get("dropped") === "1";
  const showRings = params.get("rings") === "1";
  const tabParam = params.get("tab");
  const tableTab: "universe" | "pipeline" | "land" = tabParam === "pipeline" || tabParam === "land" ? tabParam : "universe";
  const [tip, setTip] = useState("");
  const [ringCursor, setRingCursor] = useState<{ x: number; y: number } | null>(null);
  const [ringsOutside, setRingsOutside] = useState(false);
  const frameRings = useRef<(() => void) | null>(null);
  const registerFrameRings = useCallback((frame: (() => void) | null) => {
    frameRings.current = frame;
  }, []);
  const ringNoteRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const note = ringNoteRef.current;
    if (!ringCursor || !note) return;
    const map = document.querySelector(".map-stage")?.getBoundingClientRect();
    const bounds = map
      ? { left: map.left, top: map.top, right: map.right, bottom: map.bottom }
      : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    const obstacles = ["aside.drawer", "aside.layers.open", ".map-float"].flatMap((selector) => {
      const node = document.querySelector(selector);
      if (!node) return [];
      const rect = node.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return [];
      return [{ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }];
    });
    const placed = placeReadableTip({
      cursor: ringCursor,
      bounds,
      obstacles,
      widths: [248, 200],
      measure: (width) => {
        note.style.width = `${width}px`;
        return { width: note.offsetWidth || width, height: note.offsetHeight || 72 };
      },
    });
    note.style.left = `${placed.left}px`;
    note.style.top = `${placed.top}px`;
    note.style.width = `${placed.width}px`;
    note.dataset.hidden = "0";
  }, [ringCursor]);
  const [copied, setCopied] = useState(false);
  const compareIds = (params.get("compare") || "").split("|").filter(Boolean).slice(0, 4);
  const [changesNote, setChangesNote] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(params.get("alerts") === "1");
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const shell = shellRef.current;
    const bar = shell?.querySelector(".bar");
    if (!shell || !(bar instanceof HTMLElement)) return;
    const apply = () => shell.style.setProperty("--bar-h", `${Math.ceil(bar.getBoundingClientRect().height)}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [selected, stepsOpen, menuOpen]);
  const [commandOpen, setCommandOpen] = useState(false);
  const [indexedIds, setIndexedIds] = useState<Set<string> | null>(null);
  const [catalog, setCatalog] = useState<SiteFeature[] | null>(null);
  const sheetQuery = params.get("sheet");
  const sheetQueryRef = useRef(sheetQuery);
  sheetQueryRef.current = sheetQuery;
  const placedSite = useRef("");
  const leaveSite = useRef("");
  const wantedReview = useRef("");
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>(() => initialSheetSnap(sheetQuery));
  const [showSpaces, setShowSpaces] = useState(true);
  const [markedSpaces, setMarkedSpaces] = useState<SpaceShape[]>([]);
  const [spaceNames, setSpaceNames] = useState<Record<string, string>>({});
  const [marking, setMarking] = useState<{ siteId: string; lng: number; lat: number; nonce: number } | null>(null);
  const [pickedSpace, setPickedSpace] = useState("");
  const [commentedSpaceIds, setCommentedSpaceIds] = useState<string[]>([]);
  const [threadSpaceId, setThreadSpaceId] = useState("");
  const [commentFly, setCommentFly] = useState<{ lng: number; lat: number; nonce: number } | null>(null);
  const [mapNote, setMapNote] = useState("");
  useEffect(() => {
    if (!me?.u) return undefined;
    let cancel = false;
    const pull = () => {
      void fetch("/api/data/spaces", { cache: "no-store" })
        .then((response) => response.ok ? response.json() : { spaces: [] })
        .then((body: { spaces?: Array<SpaceShape & { center: { lng: number; lat: number }; lengthFt: number; widthFt: number; rotationDeg: number }>; openThreads?: string[] }) => {
          if (cancel) return;
          setCommentedSpaceIds(body.openThreads || []);
          setMarkedSpaces((body.spaces || []).map((row) => ({
            id: row.id,
            siteId: row.siteId,
            version: row.version,
            box: row.box || { center: row.center, lengthFt: row.lengthFt, widthFt: row.widthFt, rotationDeg: row.rotationDeg },
            type: row.type,
            layout: row.layout,
            estSlots: row.estSlots,
            status: row.status,
            author: row.author,
          })));
        })
        .catch(() => undefined);
    };
    pull();
    void fetch("/api/actions/accounts", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : { accounts: [] })
      .then((body: { accounts?: { id: string; name: string }[] }) => {
        if (cancel) return;
        const next: Record<string, string> = {};
        for (const account of body.accounts || []) next[account.id] = account.name;
        setSpaceNames(next);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [me?.u]);
  useEffect(() => {
    const onOpen = (event: Event) => {
      const anchor = readCommentAnchor((event as CustomEvent).detail);
      if (!anchor || anchor.type !== "space") return;
      const space = markedSpaces.find((item) => item.id === anchor.spaceId);
      if (!space) return;
      setPickedSpace(space.id);
      setThreadSpaceId(space.id);
      setSheetSnap("peek");
      setCommentFly({ lng: space.box.center.lng, lat: space.box.center.lat, nonce: Date.now() });
    };
    const onChanged = () => {
      void fetch("/api/data/spaces", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : { openThreads: [] }))
        .then((body: { openThreads?: string[] }) => setCommentedSpaceIds(body.openThreads || []))
        .catch(() => undefined);
    };
    window.addEventListener(COMMENT_OPEN, onOpen);
    window.addEventListener(COMMENT_CHANGED, onChanged);
    return () => {
      window.removeEventListener(COMMENT_OPEN, onOpen);
      window.removeEventListener(COMMENT_CHANGED, onChanged);
    };
  }, [markedSpaces]);
  const [unplacedOpen, setUnplacedOpen] = useState(false);
  const [withheldOpen, setWithheldOpen] = useState(false);

  const urlCity = params.get("city");
  const selectedMarket = !urlCity || urlCity === "all" ? "all" : urlCity === "other" ? "other" : urlCity === "PHX" || urlCity === "LAS" || urlCity === "MIA" ? urlCity : "PHX";
  const allCities = selectedMarket === "all";
  const city: MarketId = selectedMarket === "PHX" || selectedMarket === "LAS" || selectedMarket === "MIA" ? selectedMarket : "PHX";
  const scoreIssues = params.get("score") === "issue";
  function shownInMarket(recordCity: string | null | undefined): boolean {
    return inCountedMarket(recordCity, selectedMarket);
  }
  const allStages = params.get("stage") === "all";
  const stageParam = params.get("stage") as StageId | null;
  const stage: StageId = !allStages && stageParam && STEPS.some((step) => step.id === stageParam) ? stageParam : "land";
  const landTier = params.get("tier") || "any";
  const verdict = params.get("verdict") || "any";
  const listed = params.get("listed") || "any";
  const landSites = params.get("land") === "1";
  const categories = parseCategories({
    cats: params.get("cats"),
    landlayer: params.get("landlayer"),
    cstore: params.get("cstore"),
  });
  const categoriesRef = useRef(categories);
  const categoryKey = `${params.get("cats") || ""}|${params.get("landlayer") || ""}|${params.get("cstore") || ""}`;
  const categoryKeyRef = useRef(categoryKey);
  if (categoryKeyRef.current !== categoryKey) {
    categoryKeyRef.current = categoryKey;
    categoriesRef.current = categories;
  }
  const query = params.get("q") || "";
  const who = params.get("who") || "";
  const [funnelPref, setFunnelPref] = useState<{ version: string | null; value: string | null }>({ version: null, value: null });
  const funnel = resolveFunnelMode(params.get("funnel"), funnelPref);
  const showUniverse = funnel === "universe" || pinsOn;
  const showPipeline = funnel === "pipeline" || dealsOn;
  const extraParam = params.get("extra");
  const extra = extraParam === "listed" || extraParam === "contacted" || extraParam === "held" ? extraParam : null;
  const pipeView = parsePipeView(params.get("pstage"));
  const allPipes = pipeView.all;
  const pipeStage: PipeId = pipeView.stage;
  const outsideGroup = funnel === "pipeline" && params.get("outside") === "1" && allPipes;
  const listView = params.get("view") === "list";
  const [liveArea, setLiveArea] = useState<MapArea | null>(null);
  const [followArea, setFollowArea] = useState(false);
  const mapAreaLive = followArea ? liveArea : null;
  const reach: Reach = parseReach(params.get("reach"));
  const ndaParam = params.get("nda") === "1";
  const loopsParam = params.get("loops") === "1";
  const loopsAllowed = Boolean(me?.actionRole && ndaQueueAllowed(me.actionRole));
  const loopsVisible = loopsParam && loopsAllowed;
  const ndaVisible = ndaParam && !loopsVisible;
  const sortParam = params.get("sort") || "site:asc";
  const sortKey = (LIST_COLUMNS.some((column) => column.id === sortParam.split(":")[0]) ? sortParam.split(":")[0] : "site") as keyof Omit<ListRow, "id">;
  const sortDesc = sortParam.endsWith(":desc");
  const reviewing = params.get("review") === "1" || params.get("view") === "review";
  const queueMarket = params.get("qmarket") || (reviewing ? "all" : city);
  const queueStage = params.get("qstage") || (reviewing || funnel !== "pipeline" || allPipes ? "any" : pipeStage);
  const queueViable = params.get("qviable") !== "0";
  const queueFresh = params.get("qnew") === "1";
  const queueFlagged = params.get("qflag") === "1";
  const queueApproval = params.get("qapprove") === "1";
  const queueMentions = params.get("qmention") === "1";
  const queueAssigned = params.get("qassign") === "1";
  const visibleFeed = feed.filter((site) => site.status !== "snoozed");
  // /?view=review&site=ID opens that site. After the link lands, review=1 follows the queue cursor.
  const reviewDeepSite = params.get("view") === "review" ? params.get("site") : null;
  const caughtUp = reviewing && feedLoaded && !feed.some((site) => site.status === "open");
  const ranges = rangesFromSearch(params);
  const pipelineColumns = parseColumns(params.get("cols"));
  const pillParam = params.get("pill");
  const [pinPref, setPinPref] = useState<{ version: string | null; value: string | null }>({ version: null, value: null });
  const [basemap, setBasemap] = useState<"positron" | "satellite">("satellite");
  const [marketPref, setMarketPref] = useState<{ version: string | null; value: string | null }>({ version: null, value: null });
  const [marketReady, setMarketReady] = useState(false);
  const appliedMarket = useRef(false);
  const pinLabel: PinLabel = resolvePinLabel(pillParam, pinPref);
  const pipelineSortId = (PIPELINE_COLUMNS.some((column) => column.id === sortParam.split(":")[0]) ? sortParam.split(":")[0] : "site") as PipelineColumnId;

  const mapArea = parseMapArea(params);
  useEffect(() => {
    if (!me?.u) return;
    const searches = readSearches();
    const lists = readShortlists();
    if (!searches.length && !lists.length) return;
    let cancel = false;
    void (async () => {
      for (const item of searches) {
        const response = await fetch("/api/actions/views", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: item.name, query: item.query, scope: "personal" }),
        });
        if (response.ok && !cancel) removeSearch(item.name);
      }
      for (const item of lists) {
        const response = await fetch("/api/actions/views", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: item.name, query: `compare=${item.ids.join("|")}`, scope: "personal" }),
        });
        if (response.ok && !cancel) removeShortlist(item.name);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [me?.u]);
  useEffect(() => {
    let cancel = false;
    fetch("/api/data/grid").then(async (response) => {
      if (!response.ok || cancel) return;
      const payload = await response.json() as { features?: GeoFeature[] };
      if (!cancel) setGridFeatures(Array.isArray(payload.features) ? payload.features : []);
    }).catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, []);
  useEffect(() => {
    setPinPref({
      version: window.localStorage.getItem(PIN_LABEL_VERSION_KEY),
      value: window.localStorage.getItem(PIN_LABEL_STORAGE),
    });
    setFunnelPref({
      version: window.localStorage.getItem(FUNNEL_VERSION_KEY),
      value: window.localStorage.getItem(FUNNEL_STORAGE),
    });
    const base = window.localStorage.getItem("basemap");
    if (base === "satellite" || base === "positron") setBasemap(base);
    setMarketPref({
      version: window.localStorage.getItem(MARKET_VERSION_KEY),
      value: window.localStorage.getItem(MARKET_STORAGE),
    });
    setMarketReady(true);
  }, []);
  useEffect(() => {
    if (!marketReady || appliedMarket.current) return;
    appliedMarket.current = true;
    if (params.get("city") || params.get("site") || params.get("review") === "1" || params.get("view") === "review") return;
    if (marketPref.version !== MARKET_VERSION) return;
    if (marketPref.value !== "PHX" && marketPref.value !== "LAS" && marketPref.value !== "MIA") return;
    write({ city: marketPref.value });
  }, [marketReady, params, marketPref]);
  useEffect(() => {
    if (params.get("funnel")) return;
    if (funnelPref.version !== FUNNEL_VERSION || funnelPref.value !== "universe") return;
    write({ funnel: "universe" });
  }, [params, funnelPref]);
  useEffect(() => {
    if (!loopsVisible) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (window.matchMedia("(max-width: 767px)").matches) return;
      event.preventDefault();
      write({ loops: null });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loopsVisible, params]);

  function setPinLabel(next: PinLabel) {
    window.localStorage.setItem(PIN_LABEL_STORAGE, next);
    window.localStorage.setItem(PIN_LABEL_VERSION_KEY, PIN_LABEL_VERSION);
    setPinPref({ version: PIN_LABEL_VERSION, value: next });
    write({ pill: next });
  }

  function chooseFunnel(next: FunnelMode) {
    window.localStorage.setItem(FUNNEL_STORAGE, next);
    window.localStorage.setItem(FUNNEL_VERSION_KEY, FUNNEL_VERSION);
    setFunnelPref({ version: FUNNEL_VERSION, value: next });
    write({ funnel: next, tab: next === "pipeline" ? "pipeline" : null });
  }

  function chooseBasemap(next: "positron" | "satellite") {
    window.localStorage.setItem("basemap", next);
    setBasemap(next);
  }

  function write(next: Record<string, string | null>, history = false) {
    const live = typeof window === "undefined" ? params.toString() : currentSearch();
    const patch = next.site ? { q: null, ...next } : next;
    replaceSearch(live, patch, history);
  }

  function stopReview(next: Record<string, string | null> = {}) {
    wantedReview.current = "";
    leaveSite.current = "";
    write({ review: null, view: null, i: null, rsite: null, nda: null, loops: null, ...next });
  }

  function replaceSearch(base: string, next: Record<string, string | null>, history = false) {
    const url = new URLSearchParams(base.replace(/^\?/, ""));
    for (const [key, value] of Object.entries(next)) {
      if (!value) url.delete(key);
      else url.set(key, value);
    }
    const query = url.toString();
    // An empty `/?` does not clear a lone search param. `/` does, and it stays a client navigation.
    const href = query ? `/?${query}` : "/";
    rememberSearch(href);
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

  async function postSelection(ids: string[], bodyFor: (id: string) => Record<string, string>, path = "/api/actions/notes") {
    const errors: string[] = [];
    for (const id of ids) {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bodyFor(id)),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        errors.push(payload.error || "That could not be saved.");
      }
    }
    if (errors.length) throw new Error(errors[0]);
  }

  const dataGen = useRef(0);
  useEffect(() => {
    let cancel = false;
    const token = ++dataGen.current;
    Promise.all([
      fetch(`/api/data/sites?city=${city}`, { cache: "no-store" }),
      fetch("/api/data/areas"),
      fetch("/api/data/depots"),
      fetch(`/api/data/parcels?city=${city}`),
      fetch("/api/data/funnel"),
      fetch("/api/data/deals", { cache: "no-store" }),
      fetch("/api/data/unscreened"),
      fetch("/api/data/timeline/summary"),
      fetch("/api/me"),
    ]).then(async ([sitesRes, areasRes, depotsRes, parcelsRes, funnelRes, dealsRes, unscreenedRes, summaryRes, meRes]) => {
      if (sitesRes.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!sitesRes.ok || !areasRes.ok || !depotsRes.ok || !parcelsRes.ok || !funnelRes.ok || !dealsRes.ok || !unscreenedRes.ok) {
        if (!cancel && token === dataGen.current) setError("The site data could not be loaded.");
        return;
      }
      const [sitesBody, areasBody, depotsBody, parcelsBody, funnelPayload, dealsBody] = await Promise.all([
        sitesRes.json(),
        areasRes.json(),
        depotsRes.json(),
        parcelsRes.json(),
        funnelRes.json(),
        dealsRes.json(),
      ]);
      if (!cancel && token === dataGen.current) {
        setData((current) => ({
          sites: current ? preservePendingStage(current.sites, guardFeatures(sitesBody)) : guardFeatures(sitesBody),
          areas: areasBody,
          depots: depotsBody,
          parcels: parcelsBody,
          deals: current ? preservePendingStage(current.deals, guardFeatures(dealsBody)) : guardFeatures(dealsBody),
          funnel: funnelPayload.funnel,
        }));
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

  const catalogOn = useRef(false);
  catalogOn.current = Boolean(catalog);
  useEffect(() => {
    let cancel = false;
    async function refresh(token: number) {
      const requests = [
        fetch("/api/data/deals", { cache: "no-store" }),
        fetch(`/api/data/sites?city=${city}`, { cache: "no-store" }),
      ];
      if (catalogOn.current) requests.push(fetch("/api/data/sites", { cache: "no-store" }));
      const [dealsRes, sitesRes, allSitesRes] = await Promise.all(requests);
      if (cancel || token !== dataGen.current || !dealsRes?.ok || !sitesRes?.ok) return;
      const deals = await dealsRes.json();
      const sites = await sitesRes.json();
      if (cancel || token !== dataGen.current) return;
      setData((current) => (current ? { ...current, deals: preservePendingStage(current.deals, guardFeatures(deals)), sites: preservePendingStage(current.sites, guardFeatures(sites)) } : current));
      if (allSitesRes?.ok) {
        const payload = (await allSitesRes.json()) as { features?: SiteFeature[] };
        if (!cancel && token === dataGen.current) {
          const incoming = omitProtectedSites(Array.isArray(payload.features) ? payload.features : []);
          setCatalog((current) => (current ? preservePendingStage({ features: current }, { features: incoming }).features || incoming : incoming));
        }
      }
    }
    function onStage(event: Event) {
      const detail = (event as CustomEvent<StageRefresh>).detail;
      if (!detail?.targetId || !detail.stageGroup) return;
      const token = ++dataGen.current;
      setData((current) => (current ? { ...current, ...patchLiveStage(current, detail) } : current));
      setCatalog((current) => {
        if (!current) return current;
        return patchLiveStage({ deals: { features: [] }, sites: { features: current } }, detail).sites.features;
      });
      void refresh(token);
    }
    window.addEventListener(STAGE_REFRESH_EVENT, onStage);
    return () => {
      cancel = true;
      window.removeEventListener(STAGE_REFRESH_EVENT, onStage);
    };
  }, [city]);

  const needCatalog = allCities || Boolean(who) || query.trim().length >= 2;
  useEffect(() => {
    if (!needCatalog || catalog) return;
    let cancel = false;
    fetch("/api/data/sites").then(async (response) => {
      if (!response.ok || cancel) return;
      const payload = await response.json() as { features?: SiteFeature[] };
      if (!cancel) {
        const incoming = Array.isArray(payload.features) ? payload.features : [];
        setCatalog((current) => (current ? preservePendingStage({ features: current }, { features: incoming }).features || incoming : incoming));
      }
    }).catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [needCatalog, catalog]);

  const queueParams = {
    viable: queueViable ? "1" : "0",
    fresh: queueFresh ? "1" : "0",
    flagged: queueFlagged ? "1" : "0",
    approve: queueApproval ? "1" : "0",
    mentions: queueMentions ? "1" : "0",
    assigned: queueAssigned ? "1" : "0",
    reach,
  };
  const queueKey = new URLSearchParams({ market: queueMarket, stage: queueStage, ...queueParams }).toString();
  // The Review button opens every market and stage. The badge counts that queue before the click, so the number does not jump when the click widens the filter.
  const badgeKey = new URLSearchParams({
    market: "all",
    stage: "any",
    ...queueParams,
  }).toString();
  useEffect(() => {
    const refresh = () => setQueueTick((value) => value + 1);
    window.addEventListener("queue-refresh", refresh);
    return () => window.removeEventListener("queue-refresh", refresh);
  }, []);
  useEffect(() => {
    if (!me?.actionsEnabled) return;
    const key = queueKey;
    let cancel = false;
    quietActionsFetch(`/api/queue?${key}`).then(async (response) => {
      if (cancel) return;
      if (!response.ok) {
        setLoadedQueueKey(key);
        setFeedLoaded(true);
        return;
      }
      const payload = (await response.json()) as { items?: { siteId: string; followed?: boolean; needsApproval?: boolean; mentioned?: boolean; assigned?: boolean; city?: string; firstVisit?: boolean; reviewedAt?: string; reasons?: FeedSite["reasons"]; snapshot?: { name?: string; city?: string; lng?: number | null; lat?: number | null } | null }[] };
      if (cancel) return;
      const next = (payload.items || []).filter((item) => !isPipelineStore({
        kind: "pipeline",
        name: item.snapshot?.name,
        business_type: (item.snapshot as { businessType?: string } | null)?.businessType,
        description: (item.snapshot as { description?: string } | null)?.description,
      })).map((item) => ({
        siteId: item.siteId,
        name: item.snapshot?.name || item.siteId,
        city: item.snapshot?.city || item.city || "",
        lng: item.snapshot?.lng ?? null,
        lat: item.snapshot?.lat ?? null,
        followed: Boolean(item.followed),
        needsApproval: Boolean(item.needsApproval),
        mentioned: Boolean(item.mentioned),
        assigned: Boolean(item.assigned),
        reasons: item.reasons || [],
        status: "open" as const,
        previous: null,
        firstVisit: Boolean(item.firstVisit),
        reviewedAt: item.reviewedAt || "",
      }));
      setFeed(next);
      setLoadedQueueKey(key);
      setFeedLoaded(true);
    }).catch(() => {
      if (!cancel) {
        setLoadedQueueKey(key);
        setFeedLoaded(true);
      }
    });
    return () => {
      cancel = true;
    };
  }, [me?.actionsEnabled, queueKey, queueTick]);

  useEffect(() => {
    if (!me?.actionsEnabled) return;
    let cancel = false;
    quietActionsFetch(`/api/queue?${badgeKey}`).then(async (response) => {
      if (cancel || !response.ok) return;
      const payload = (await response.json()) as { items?: { snapshot?: { name?: string } | null }[] };
      if (cancel) return;
      const next = (payload.items || []).filter((item) => !isPipelineStore({
        kind: "pipeline",
        name: item.snapshot?.name,
        business_type: (item.snapshot as { businessType?: string } | null)?.businessType,
        description: (item.snapshot as { description?: string } | null)?.description,
      }));
      setQueueCount(next.length);
    }).catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [me?.actionsEnabled, badgeKey, queueTick]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1100px)");
    const apply = () => setLayersOpen(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const apply = () => {
      const panel = params.get("panel");
      const linked = panel === "discussion" || panel === "numbers" || panel === "activity" || panel === "proposal" || panel === "financials" || panel === "intel";
      if (linked && window.matchMedia("(max-width: 767px)").matches) {
        setSheetSnap("full");
        return;
      }
      setSheetSnap(initialSheetSnap(sheetQueryRef.current));
    };
    apply();
    const media = window.matchMedia("(max-width: 767px)");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [selected, params]);

  useEffect(() => {
    function onSnap(event: Event) {
      const next = (event as CustomEvent<string>).detail;
      if (next === "peek" || next === "half" || next === "full") setSheetSnap(next);
    }
    window.addEventListener("sites-sheet-snap", onSnap);
    return () => window.removeEventListener("sites-sheet-snap", onSnap);
  }, []);

  useEffect(() => {
    const site = params.get("site");
    if (site && isProtectedId(site)) {
      setSelected(null);
      write({ site: null });
      return;
    }
    setSelected(site);
  }, [params]);

  useEffect(() => {
    if (params.get("review") !== "1" || !params.get("q")) return;
    write({ q: null });
  }, [params]);

  useEffect(() => {
    function openCommand() {
      setCommandOpen(true);
    }
    function onCommand(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== "k" && event.code !== "KeyK") return;
      event.preventDefault();
      event.stopPropagation();
      openCommand();
    }
    window.addEventListener("keydown", onCommand, true);
    window.addEventListener("sites-open-command", openCommand);
    return () => {
      window.removeEventListener("keydown", onCommand, true);
      window.removeEventListener("sites-open-command", openCommand);
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "/" && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement) && !(event.target instanceof HTMLSelectElement)) {
        event.preventDefault();
        setCommandOpen(true);
        return;
      }
      if (event.key !== "Escape") return;
      setCommandOpen(false);
      setFiltersOpen(false);
      setMoreOpen(false);
      setUserOpen(false);
      setMenuOpen(false);
      setUnplacedOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const q = (params.get("q") || "").trim();
    if (q.length < 2) {
      setIndexedIds(null);
      return;
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}&scope=grid`, { signal: ctrl.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { mode?: string; ids?: string[] } | null) => {
          if (!body || body.mode !== "index" || !Array.isArray(body.ids)) {
            setIndexedIds(null);
            return;
          }
          setIndexedIds(new Set(body.ids));
        })
        .catch(() => setIndexedIds(null));
    }, 200);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [params]);

  const features = data?.sites.features ?? [];
  const featureById = useMemo(() => {
    const map = new Map<string, SiteFeature>();
    for (const feature of features) map.set(feature.properties.site_id, feature);
    return map;
  }, [features]);
  const censusFeatures = features.filter((feature) => feature.properties.origin !== "off-market");
  const sites = censusFeatures.map((feature) => presentSite(feature.properties));
  const offMarketFeatures = features.filter((feature) => feature.properties.origin === "off-market" && shownInMarket(feature.properties.city));
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

  function atStage(site: SiteProps, step: StageId) {
    return inStage(site, step, reach);
  }

  function passesChips(site: SiteProps, loose: boolean, anyMarket = false) {
    if (!anyMarket && !shownInMarket(site.city)) return false;
    if (!siteInCategories(site, links, categories)) return false;
    if (query && !matchesQuery(query, siteSearchParts(site)) && !indexedIds?.has(site.site_id) && !(site.linked_deal_id && indexedIds?.has(site.linked_deal_id))) return false;
    if (loose) return true;
    if (siteCategory(site, links) === "wash" && !matchesLandTier(site, landTier)) return false;
    if (verdict !== "any" && (site.verdict || "none") !== verdict) return false;
    if (listed === "yes" && !site.listed) return false;
    return true;
  }

  function setCategory(id: CategoryId, on: boolean) {
    const next = { ...categoriesRef.current, [id]: on };
    categoriesRef.current = next;
    write(categorySearch(next));
  }

  useEffect(() => {
    setTip("");
  }, [funnel, city, stage]);

  const dealFeatures = data?.deals.features ?? [];
  const dealRows = dealFeatures.map((feature) => feature.properties);
  const links = landLinks(dealRows);
  const viewStage: StageId = allStages ? "universe" : stage;
  const localSiteMatches = query
    ? sites.filter((site) => atStage(site, viewStage) && passesChips(site, false)).length
    : 0;
  const universeWide = funnel !== "pipeline" && query.trim().length >= 2 && localSiteMatches === 0;
  const catalogSites = (catalog ?? []).filter((feature) => feature.properties.origin !== "off-market").map((feature) => presentSite(feature.properties));
  const reviewScopeId = params.get("rsite") || "";
  const reviewScopeIds = reviewScopeId ? linkedPnlIds(reviewScopeId, linksFromRecords([
    ...dealRows.map((deal) => ({ dealId: deal.deal_id, siteId: deal.universe_id })),
    ...sites.map((site) => ({ dealId: site.linked_deal_id, siteId: site.site_id })),
    ...catalogSites.map((site) => ({ dealId: site.linked_deal_id, siteId: site.site_id })),
  ])) : [];
  const reviewQueueReady = feedLoaded && loadedQueueKey === queueKey;
  const reviewScoped = Boolean(reviewScopeId);
  const reviewList = reviewScoped ? visibleFeed.filter((site) => reviewScopeIds.includes(site.siteId)) : visibleFeed;
  const reviewDeepIndex = reviewDeepSite ? reviewList.findIndex((site) => site.siteId === reviewDeepSite) : -1;
  const reviewIndex = reviewDeepIndex >= 0
    ? reviewDeepIndex
    : Math.min(Math.max(Number(params.get("i") || "1") - 1, 0), Math.max(reviewList.length - 1, 0));
  const reviewCurrent = reviewList[reviewIndex];
  const reviewMiss = reviewScoped && reviewQueueReady && reviewList.length === 0;
  const reviewScopeName = (() => {
    if (!reviewScopeId) return "";
    const deal = dealRows.find((row) => row.deal_id === reviewScopeId);
    if (deal?.name?.trim()) return deal.name.trim();
    const site = sites.find((row) => row.site_id === reviewScopeId) || catalogSites.find((row) => row.site_id === reviewScopeId);
    return site?.name?.trim() || reviewScopeId;
  })();
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
      add(sitePool.filter((site) => shownInMarket(site.city) && atStage(site, step) && site.listed && passesChips(site, true, anyMarket)));
    } else if (extra === "contacted" && !universeWide) {
      add(sitePool.filter((site) => shownInMarket(site.city) && atStage(site, step) && site.contacted && passesChips(site, true, anyMarket)));
    } else {
      add(sitePool.filter((site) => atStage(site, step) && passesChips(site, false, anyMarket)));
      if (showDropped) add(sitePool.filter((site) => droppedAt(site, step) && passesChips(site, true, anyMarket)));
      if (landSites) add(sitePool.filter((site) => site.land_only && passesChips(site, true, anyMarket)));
    }
    return [...byId.values()].sort(compareSites);
    // passesChips closes over the chip state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, catalog, stage, city, allStages, allCities, universeWide, landTier, verdict, listed, landSites, showDropped, compare, query, extra, categories, who, data?.deals, links, reach, indexedIds]);

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
    if (indexedIds?.has(deal.deal_id) || (deal.universe_id && indexedIds?.has(deal.universe_id))) return true;
    return matchesQuery(query, dealSearchParts(deal));
  }

  function dealAllowed(deal: DealProps, keepSelected = false): boolean {
    if (keepSelected && selected === deal.deal_id) return true;
    return dealInCategories(deal, categories);
  }

  function inDealMarket(deal: DealProps, wide: boolean) {
    if (wide || selectedMarket === "all") return true;
    if (selectedMarket === "other") return shownInMarket(deal.city);
    const feature = dealFeatures.find((item) => item.properties.deal_id === deal.deal_id);
    const coords = feature?.geometry?.coordinates;
    return inSelectedMarket(deal, city, coords ? [coords[0], coords[1]] : null);
  }

  const localDealMatches = query
    ? dealRows.filter((deal) => {
        if (deal.kind !== "pipeline" && deal.kind !== "land") return false;
        if (!inReach(deal, reach) || !dealAllowed(deal)) return false;
        if (!inDealMarket(deal, false)) return false;
        if (!allPipes && !who && deal.stage_group !== pipeStage) return false;
        if (who && !partyMatch(who, deal.broker, deal.firm)) return false;
        return dealQueryHit(deal);
      }).length
    : 0;
  const pipelineWide = funnel === "pipeline" && query.trim().length >= 2 && localDealMatches === 0 && !who;
  const dealWide = pipelineWide || allPipes || Boolean(who);
  const showDroppedRows = droppedDealsShown({
    all: allPipes,
    stage: pipeStage,
    droppedLayer: showDroppedDeals,
    searchWide: pipelineWide || Boolean(who),
  });
  function viewDeal(deal: DealProps): boolean {
    if (isProtectedId(deal.deal_id)) return false;
    if (outsideGroup) return outsideServiceArea(deal);
    if (!allPipes && !dealWide) return dealOnPipeStep(deal, pipeStage, reach);
    if (inReach(deal, reach)) return true;
    return showDroppedRows && deal.stage_group === "dropped";
  }
  function includeDropped(group: string) {
    if (group !== "dropped") return true;
    return showDroppedRows;
  }

  const pipelineDeals = dealRows.filter((deal) => {
    if (deal.kind !== "pipeline") return false;
    if (!viewDeal(deal)) return false;
    if (!dealAllowed(deal)) return false;
    if (who && !partyMatch(who, deal.broker, deal.firm)) return false;
    if (!inDealMarket(deal, pipelineWide)) return false;
    if (!includeDropped(deal.stage_group)) return false;
    if (query && !dealQueryHit(deal)) return false;
    return true;
  });
  const landDeals = dealRows.filter((deal) => {
    if (deal.kind !== "land") return false;
    if (!viewDeal(deal)) return false;
    if (!dealAllowed(deal)) return false;
    if (who && !partyMatch(who, deal.broker, deal.firm)) return false;
    if (!inDealMarket(deal, pipelineWide)) return false;
    if (!includeDropped(deal.stage_group)) return false;
    if (query && !dealQueryHit(deal)) return false;
    return true;
  });

  function openInReview(id: string) {
    write({
      review: "1",
      rsite: id,
      i: "1",
      site: id,
      view: null,
      table: null,
      funnel: "pipeline",
      q: null,
      qmarket: "all",
      qstage: "any",
    });
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
      if (coords && Number.isFinite(coords[0]) && Number.isFinite(coords[1])) return [coords[0], coords[1]];
    }
    const feature = dealFeatures.find((item) => item.properties.deal_id === deal.deal_id);
    const coords = feature?.geometry?.coordinates;
    return coords && Number.isFinite(coords[0]) && Number.isFinite(coords[1]) ? [coords[0], coords[1]] : null;
  }

  function asSquare(deal: DealProps): DealFeature | null {
    const feature = dealFeatures.find((item) => item.properties.deal_id === deal.deal_id);
    const point = dealPoint(deal);
    if (!feature || !point) return null;
    return { ...feature, geometry: { type: "Point", coordinates: point } };
  }

  const pipelineStepRows = pipelineDeals;
  const pipelineSquares = pipelineStepRows.map(asSquare).filter((feature): feature is DealFeature => Boolean(feature));
  const stageLandRows = landDeals.filter((deal) => funnel !== "pipeline" || dealWide || dealOnPipeStep(deal, pipeStage, reach));
  const stageLandSquares = stageLandRows.map(asSquare).filter((feature): feature is DealFeature => Boolean(feature));
  const landSiteDrawn = new Set(
    visibleFeatures
      .filter((feature) => feature.geometry && isLandParcelSite(feature.properties, links))
      .map((feature) => feature.properties.site_id),
  );
  const drawnDealsBase: DealFeature[] = funnel === "pipeline"
    ? [
        ...(showPipeline ? pipelineSquares : []),
        ...stageLandSquares,
      ]
    : [
        ...(showPipeline ? pipelineDeals.filter((deal) => !deal.universe_id) : []),
        ...landDeals.filter((deal) => !deal.universe_id || !landSiteDrawn.has(deal.universe_id)),
      ]
        .map((deal) => dealFeatures.find((feature) => feature.properties.deal_id === deal.deal_id))
        .filter((feature): feature is DealFeature => Boolean(feature?.geometry));
  const listedStepEmpty = funnel !== "pipeline" && listed === "yes" && !query && visibleSites.length === 0;
  const handoffStep: StageId | null = !listedStepEmpty ? null
    : stage !== "universe" && subcount("universe", "listed") > 0 ? "universe"
    : stage !== "in_area" && subcount("in_area", "listed") > 0 ? "in_area"
    : null;
  const shownFeatures = handoffStep ? listedFeatures(handoffStep) : visibleFeatures;
  const handoffCopy = handoffStep
    ? `${STEPS.find((step) => step.id === stage)?.label || "This step"} has no listed sites. Showing ${handoffStep === "universe" ? "Universe" : "Service area"}, which has ${subcount(handoffStep, "listed").toLocaleString()} listed.`
    : handoff;
  const areaDeals = (listedStepEmpty ? [] : drawnDealsBase).filter((feature) => {
    if (funnel === "pipeline" && dealCategory(feature.properties) === "wash" && !matchesOpenLandTier(feature.properties.open_land_sqft, landTier)) return false;
    if (!mapArea) return true;
    const coords = feature.geometry?.coordinates;
    return coords ? inMapArea(coords[0], coords[1], mapArea) : false;
  });
  const drawnDeals = areaDeals;
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
  const stepKey = `${funnel}|${stage}|${pipeStage}|${listed}|${allStages}|${allPipes}|${outsideGroup}`;
  const seenStep = useRef(stepKey);
  useEffect(() => {
    if (seenStep.current === stepKey) return;
    seenStep.current = stepKey;
    setStepsOpen(false);
  }, [stepKey]);
  useEffect(() => {
    if (!data || funnel === "pipeline" || !listedStepEmpty) return;
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
      setHandoff(`${from} has no listed sites. Showing Service area, which has ${areaListed.toLocaleString()} listed.`);
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
  const selectedSquare = selectedDeal ? asSquare(selectedDeal) : null;
  if (selectedSquare && !drawnDeals.some((feature) => feature.properties.deal_id === selectedDeal?.deal_id)) drawnDeals.push(selectedSquare);
  const selectedUnscreened = unscreened.find((feature) => feature.properties.listing_id === selected)?.properties ?? null;
  const washPoints = (() => {
    if (!overlaysOn.includes("washes") || (!selectedDeal && !selectedSite)) return [];
    const origin = selectedDeal ? dealPoint(selectedDeal) : (() => {
      const coords = featureById.get(selectedSite?.site_id || "")?.geometry?.coordinates;
      return coords ? [coords[0], coords[1]] as [number, number] : null;
    })();
    if (!origin) return [];
    const pool = catalog && catalog.length ? catalog : features;
    const exclude = new Set<string>();
    if (selectedSite) exclude.add(selectedSite.site_id);
    if (selectedDeal?.universe_id) exclude.add(selectedDeal.universe_id);
    const rows: WashSite[] = pool.map((feature) => ({
      id: feature.properties.site_id,
      name: feature.properties.name || feature.properties.address || feature.properties.site_id,
      lng: feature.geometry?.coordinates?.[0] ?? null,
      lat: feature.geometry?.coordinates?.[1] ?? null,
      businessType: feature.properties.business_type,
      verdict: feature.properties.verdict,
      landOnly: Boolean(feature.properties.land_only),
    }));
    return nearbyWashPoints(origin, rows, exclude);
  })();
  const withheldHere = showUnscreened ? unscreened.filter((feature) => shownInMarket(feature.properties.city) && !feature.properties.pinned) : [];

  const selectedDealId = dealRows.some((deal) => deal.deal_id === selected) ? selected : "";
  const selectedSiteId = selectedDealId
    ? (dealRows.find((deal) => deal.deal_id === selectedDealId)?.universe_id || "")
    : (selected || "");
  useEffect(() => {
    if (!selected || !data) return;
    if (!selectedSiteId) {
      setFiguresReady(true);
      return;
    }
    let cancel = false;
    setFiguresReady(false);
    fetch(`/api/data/sites/${encodeURIComponent(selectedSiteId)}`).then(async (response) => {
      if (cancel) return;
      if (response.ok) setDetail(presentSite((await response.json()) as SiteProps));
      setFiguresReady(true);
    }).catch(() => {
      if (!cancel) setFiguresReady(true);
    });
    return () => {
      cancel = true;
    };
  }, [selected, selectedSiteId, data]);

  function choose(id: string | null) {
    if (id && isProtectedId(id)) return;
    setSelected(id);
    setFiguresReady(!id);
    write({ site: id }, true);
  }

  function rememberMarket(nextCity: string) {
    const value = nextCity === "PHX" || nextCity === "LAS" || nextCity === "MIA" ? nextCity : "all";
    window.localStorage.setItem(MARKET_STORAGE, value);
    window.localStorage.setItem(MARKET_VERSION_KEY, MARKET_VERSION);
    setMarketPref({ version: MARKET_VERSION, value });
  }

  function jump(nextCity: string) {
    setSelected(null);
    if (nextCity === "PHX" || nextCity === "LAS" || nextCity === "MIA" || nextCity === "all") rememberMarket(nextCity);
    write({ city: nextCity === "all" ? null : nextCity, site: null }, true);
  }

  function openParty(name: string) {
    const next = name.trim();
    if (!next) return;
    setSelected(null);
    write({ who: next, funnel: "pipeline", tab: "pipeline", pstage: null, city: "all", view: "list", site: null, q: null }, true);
  }

  function filtersOn() {
    return Boolean(query || landTier !== "any" || verdict !== "any" || listed === "yes" || landSites || compare || showDropped);
  }

  function count(step: StageId) {
    return sitePool.filter((site) => shownInMarket(site.city) && atStage(site, step) && siteInCategories(site, links, categories)).length;
  }

  function filteredAt(step: StageId) {
    if (compare) return sitePool.filter((site) => shownInMarket(site.city) && site.verdict_disagreement && passesChips(site, true) && atStage(site, step)).length;
    let total = sitePool.filter((site) => atStage(site, step) && passesChips(site, false)).length;
    if (landSites) total += sitePool.filter((site) => site.land_only && shownInMarket(site.city) && passesChips(site, true)).length;
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
    return sitePool.filter((site) => shownInMarket(site.city) && atStage(site, step) && site[field] && passesChips(site, false)).length;
  }

  function listedFeatures(step: StageId): SiteFeature[] {
    return sitePool.filter((site) => shownInMarket(site.city) && atStage(site, step) && site.listed && passesChips(site, true)).flatMap((site) => {
      const feature = poolById.get(site.site_id);
      if (!feature) return [];
      if (mapArea) {
        const coords = feature.geometry?.coordinates;
        if (!coords || !inMapArea(coords[0], coords[1], mapArea)) return [];
      }
      return [{ ...feature, properties: site }];
    });
  }

  function countLiveContactedDeals() {
    return dealRows.filter((deal) => {
      if (!isLiveContactedDeal(deal) || !shownInMarket(deal.city)) return false;
      if (!inReach(deal, reach) || !dealAllowed(deal)) return false;
      if (!query) return true;
      return dealQueryHit(deal);
    }).length;
  }

  const heldCount = sites.filter((site) => site.city === city && heldOutside(site) && siteInCategories(site, links, categories)).length;
  const censusForCity = data?.funnel.stages.find((item) => item.id === "census")?.by_city?.[city] ?? 0;

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  function selectionPatch(id: string, search: URLSearchParams = params): Record<string, string | null> {
    const patch: Record<string, string | null> = {};
    const deal = dealRows.find((row) => row.deal_id === id);
    if (deal) {
      if (deal.city === "PHX" || deal.city === "LAS" || deal.city === "MIA") {
        const wantCity = marketSearchValue(deal.city);
        if ((search.get("city") || null) !== wantCity) patch.city = wantCity;
      }
      if (search.get("funnel") !== "pipeline") {
        patch.funnel = "pipeline";
        patch.tab = "pipeline";
      }
      const view = parsePipeView(search.get("pstage"));
      const known = PIPE_STEPS.some((step) => step.id === deal.stage_group) || deal.stage_group === "contacted" || deal.stage_group === "later" || deal.stage_group === "sourced";
      const droppedVisible = droppedDealsShown({
        all: view.all,
        stage: view.stage,
        droppedLayer: search.get("dropped") === "1",
        searchWide: false,
      });
      const stageShown = (view.all || search.get("pstage") === deal.stage_group) && (deal.stage_group !== "dropped" || droppedVisible);
      if (!stageShown) {
        patch.pstage = known ? deal.stage_group : null;
        patch.outside = null;
      }
      return patch;
    }
    const site = features.find((feature) => feature.properties.site_id === id)?.properties;
    if (!site) return patch;
    if (site.city === "PHX" || site.city === "LAS" || site.city === "MIA") {
      const wantCity = marketSearchValue(site.city);
      if ((search.get("city") || null) !== wantCity) patch.city = wantCity;
    }
    if (resolveFunnelMode(search.get("funnel"), funnelPref) === "pipeline") {
      patch.funnel = "universe";
      patch.tab = null;
    }
    return patch;
  }

  useEffect(() => {
    if (!data || !selected || reviewing) return;
    if (placedSite.current === selected) return;
    placedSite.current = selected;
    const patch = selectionPatch(selected);
    delete patch.cats;
    delete patch.landlayer;
    delete patch.cstore;
    delete patch.land;
    if (Object.keys(patch).length) write(patch);
  }, [data, selected, reviewing, params]);

  const linkedReviewSite = params.get("view") === "review" ? params.get("site") || "" : "";
  const linkedReviewDeal = linkedReviewSite ? dealRows.find((deal) => deal.deal_id === linkedReviewSite) : undefined;
  const droppedReviewLink = Boolean(
    linkedReviewDeal && linkedReviewDeal.stage_group === "dropped" && params.get("qviable") !== "0",
  );
  const reviewQueueSettled = (feedLoaded && loadedQueueKey === queueKey) || (me != null && !me.actionsEnabled);
  const linkedInQueue = Boolean(linkedReviewSite && feed.some((item) => item.siteId === linkedReviewSite && item.status !== "snoozed"));
  const missingReviewLink = Boolean(linkedReviewSite && reviewQueueSettled && !linkedInQueue && !droppedReviewLink);
  const leaveLinkedReview = droppedReviewLink || missingReviewLink;
  if (linkedReviewSite) wantedReview.current = linkedReviewSite;
  if (params.get("review") === "1" && wantedReview.current && params.get("site") === wantedReview.current) wantedReview.current = "";
  if (linkedInQueue && !droppedReviewLink) leaveSite.current = "";
  else if (leaveLinkedReview && linkedReviewSite) leaveSite.current = linkedReviewSite;
  const inReview = reviewing && !leaveLinkedReview;

  const reviewSiteId = inReview && !caughtUp && !reviewMiss ? reviewCurrent?.siteId : undefined;
  useEffect(() => {
    const id = leaveSite.current;
    if (!id) return;
    placedSite.current = id;
    setSelected(id);
    let timer = 0;
    const apply = () => {
      const search = new URLSearchParams(window.location.search);
      const patch = selectionPatch(id, search);
      const stillReview = search.get("view") === "review" || search.get("review") === "1";
      const known = dealRows.some((deal) => deal.deal_id === id)
        || features.some((feature) => feature.properties.site_id === id);
      if (!stillReview && known && Object.keys(patch).length === 0) {
        leaveSite.current = "";
        wantedReview.current = "";
        return true;
      }
      if (!stillReview && data && !known) {
        leaveSite.current = "";
        wantedReview.current = "";
        return true;
      }
      if (feed.some((item) => item.siteId === id && item.status !== "snoozed") && !dealRows.some((deal) => deal.deal_id === id && deal.stage_group === "dropped" && search.get("qviable") !== "0")) {
        leaveSite.current = "";
        return true;
      }
      replaceSearch(search.toString(), {
        ...patch,
        site: id,
        ...(stillReview ? { view: null, review: null, i: null, rsite: null } : {}),
      });
      return false;
    };
    if (!apply()) {
      timer = window.setInterval(() => {
        if (apply()) window.clearInterval(timer);
      }, 200);
    }
    const stop = window.setTimeout(() => window.clearInterval(timer), 5000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [leaveLinkedReview, data, feedLoaded, linkedReviewSite]);

  useEffect(() => {
    const restoreId = !reviewing ? wantedReview.current : "";
    const restoreDeal = restoreId ? dealRows.find((row) => row.deal_id === restoreId) : undefined;
    const restoreDropped = Boolean(restoreDeal && restoreDeal.stage_group === "dropped" && params.get("qviable") !== "0");
    if (restoreId && !restoreDropped && feed.some((item) => item.siteId === restoreId && item.status !== "snoozed")) {
      const at = feed.findIndex((item) => item.siteId === restoreId && item.status !== "snoozed");
      const patch: Record<string, string | null> = { review: "1", view: null, i: String(at + 1), site: restoreId, funnel: "pipeline", tab: "pipeline", table: null };
      if (restoreDeal && (restoreDeal.city === "PHX" || restoreDeal.city === "LAS" || restoreDeal.city === "MIA")) patch.city = marketSearchValue(restoreDeal.city);
      if (restoreDeal && (restoreDeal.stage_group === "desk" || restoreDeal.stage_group === "contacted" || restoreDeal.stage_group === "later" || restoreDeal.stage_group === "dropped")) {
        patch.pstage = restoreDeal.stage_group;
      }
      setSelected(restoreId);
      write(patch);
      return;
    }
    if (droppedReviewLink) return;
    if (linkedReviewSite && reviewQueueSettled && !linkedInQueue) return;
    if (linkedReviewSite && !reviewQueueSettled && data) {
      const deal = dealRows.find((row) => row.deal_id === linkedReviewSite);
      const patch: Record<string, string | null> = { site: linkedReviewSite, funnel: "pipeline", tab: "pipeline", table: null };
      if (deal && (deal.city === "PHX" || deal.city === "LAS" || deal.city === "MIA")) patch.city = marketSearchValue(deal.city);
      if (deal && (deal.stage_group === "desk" || deal.stage_group === "contacted" || deal.stage_group === "later" || deal.stage_group === "dropped")) {
        patch.pstage = deal.stage_group;
      }
      const placed = params.get("site") === linkedReviewSite
        && params.get("funnel") === "pipeline"
        && params.get("view") === "review"
        && (params.get("city") || null) === (patch.city ?? null)
        && (params.get("pstage") || null) === (patch.pstage ?? null);
      if (!placed) write(patch);
      return;
    }
    if (!reviewing || !feedLoaded) return;
    if (reviewScoped && !reviewQueueReady) return;
    if (reviewMiss) {
      setSelected(reviewScopeId);
      const aligned = params.get("site") === reviewScopeId
        && params.get("review") === "1"
        && params.get("rsite") === reviewScopeId
        && !params.get("i");
      if (!aligned) {
        write({
          review: "1",
          rsite: reviewScopeId,
          site: reviewScopeId,
          i: null,
          view: null,
          funnel: "pipeline",
          tab: "pipeline",
          table: null,
        });
      }
      return;
    }
    if (reviewDeepSite && reviewDeepIndex < 0) return;
    if (!reviewSiteId) {
      setSelected(null);
      return;
    }
    const deal = dealFeatures.find((feature) => feature.properties.deal_id === reviewSiteId)?.properties;
    const patch: Record<string, string | null> = { review: "1", i: String(reviewIndex + 1), site: reviewSiteId, funnel: "pipeline", tab: "pipeline", view: null, table: null };
    if (deal && (deal.city === "PHX" || deal.city === "LAS" || deal.city === "MIA")) patch.city = marketSearchValue(deal.city);
    if (deal && (deal.stage_group === "desk" || deal.stage_group === "contacted" || deal.stage_group === "later" || deal.stage_group === "dropped")) {
      patch.pstage = deal.stage_group;
    }
    setSelected(reviewSiteId);
    const aligned = params.get("site") === reviewSiteId
      && params.get("funnel") === "pipeline"
      && params.get("review") === "1"
      && (params.get("i") || "1") === String(reviewIndex + 1)
      && (params.get("city") || null) === (patch.city ?? null)
      && (params.get("pstage") || null) === (patch.pstage ?? null);
    if (!aligned) write(patch);
  }, [reviewing, feedLoaded, reviewSiteId, reviewIndex, reviewDeepSite, reviewDeepIndex, dealFeatures.length, params, droppedReviewLink, linkedReviewSite, reviewQueueSettled, linkedInQueue, data, feed, reviewScoped, reviewQueueReady, reviewMiss, reviewScopeId]);

  function relatedPanel(current: { id: string; kind: "site" | "deal"; name?: string | null; address?: string | null; apn?: string | null }) {
    const records = [
      ...sites.map((site) => ({ id: site.site_id, kind: "site" as const, name: site.name, address: site.address, apn: site.apn })),
      ...dealRows.map((deal) => ({ id: deal.deal_id, kind: "deal" as const, name: deal.name, address: deal.address, apn: deal.apn })),
    ];
    const hits = relatedRecords(current, records).filter((hit) => hit.label && hit.label !== hit.id);
    if (!hits.length) return null;
    return (
      <section className="related-records same-parcel" data-testid="related-records">
        {hits.map((hit) => {
          const place = hit.via === "apn" ? "parcel" : "address";
          return (
            <p key={hit.id}>
              Same {place} as <button type="button" className="text-link" onClick={() => choose(hit.id)}>{hit.label}</button>
            </p>
          );
        })}
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

  const wideCity = (pipelineWide ? pipelineDeals[0]?.city : universeWide ? visibleSites[0]?.city : "") || "";
  const home = marketFocus(allCities ? "all" : city);
  const wideFocus = !allCities && (pipelineWide || universeWide) && CITY_VIEW[wideCity] ? CITY_VIEW[wideCity] : null;
  const focus = wideFocus ?? home;
  const fitAll = allCities && !selected && !reviewing && (funnel === "pipeline" ? dealFeatures.length > 0 : catalogSites.length > 0);
  const dropCount = sites.filter((site) => droppedAt(site, stage) && shownInMarket(site.city) && siteInCategories(site, links, categories)).length;

  const sheet = {
    expanded: sheetSnap === "full",
    snap: sheetSnap,
    onToggle: () => setSheetSnap((snap) => (snap === "full" ? "half" : snap === "peek" ? "half" : "full")),
    onSnap: setSheetSnap,
    onStep: (direction: "more" | "less") => setSheetSnap((snap) => stepSheet(snap, direction)),
  };
  const unplacedDeals = dealRows.filter((deal) => (deal.kind === "pipeline" || deal.kind === "land") && shownInMarket(deal.city) && !dealPoint(deal) && inReach(deal, reach) && dealAllowed(deal));
  const offMarketPool = (universeWide || allCities) && catalog ? catalog.filter((feature) => feature.properties.origin === "off-market") : offMarketFeatures;
  const offMarketShown = funnel === "pipeline" || (extra && !universeWide) ? [] : offMarketPool.filter((feature) => {
    if (!feature.geometry) return false;
    if (!(allStages || universeWide || stage === "universe") && !atStage(feature.properties, stage)) return false;
    return passesChips(feature.properties, false, universeWide);
  });
  const universePins = showUniverse ? shownFeatures.filter((feature) => feature.geometry) : [];
  const unscreenedPins = showUnscreened ? unscreened.filter((feature) => shownInMarket(feature.properties.city) && feature.geometry) : [];
  const pinCount = (funnel === "pipeline" ? drawnDeals.length : universePins.length + offMarketShown.length) + unscreenedPins.length;
  const siteById = new Map([...sites, ...catalogSites].map((site) => [site.site_id, site]));

  function siteTypeLabel(site: SiteProps): string {
    if (siteCategory(site, links) !== "land") return site.business_type || "Car wash";
    const deal = dealRows.find((row) => row.deal_id === site.linked_deal_id || row.universe_id === site.site_id);
    const typed = String(deal?.business_type || "").trim();
    if (typed && typed.toLowerCase() !== "car wash") return typed;
    return "Land";
  }

  function nearText(record?: { service_area_class?: DealProps["service_area_class"]; service_area_distance_mi?: number | null } | null) {
    if (record?.service_area_class !== "near_0_5" && record?.service_area_class !== "near_5_10") return "";
    return serviceAreaChip(record);
  }

  function nearShort(record?: { service_area_class?: DealProps["service_area_class"]; service_area_distance_mi?: number | null } | null) {
    if (!nearText(record)) return "";
    return serviceAreaShort(record);
  }

  function siteRow(site: SiteProps): ListRow {
    const price = site.listed && site.asking_price_display ? `${site.asking_price_display}${site.asking_price_source ? ` · ${site.asking_price_source}` : ""}` : "";
    return {
      id: site.site_id,
      site: site.name || site.address || site.site_id,
      type: siteTypeLabel(site),
      city: site.city,
      stage: plainVerdict(site.verdict),
      score: displayScore(dealForSite(site)?.score) || "—",
      tier: tierLabel(spareTier(site)) || "",
      spare: site.spare_ac_own != null ? `${site.spare_ac_own} ac` : "",
      grade: capacitySummary(factsForSite(site, dealForSite(site))),
      zoning: site.zoning || "",
      traffic: vehiclesPerDay(site.aadt_count, site.aadt_year),
      listed: site.listed ? `Yes${price ? ` · ${price}` : ""}` : "No",
      lead: leadSourceLine(site, dealRows.find((deal) => deal.deal_id === site.linked_deal_id || deal.universe_id === site.site_id)),
      near: nearText(dealForSite(site)?.service_area_class ? dealForSite(site) : site),
      nearShort: nearShort(dealForSite(site)?.service_area_class ? dealForSite(site) : site),
      address: displayAddress(site.address),
      listingUrl: listingHref(dealForSite(site)?.listing_url || site.listing_url),
      folderUrl: folderHref(site.folder_url || dealForSite(site)?.folder_url),
      packageUrl: dealForSite(site)?.package_href || "",
      ...pointOf(featureById.get(site.site_id)?.geometry?.coordinates),
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
      score: displayScore(deal.score) || "—",
      tier: linked ? tierLabel(spareTier(linked)) || "" : "",
      spare: linked?.spare_ac_own != null ? `${linked.spare_ac_own} ac` : "",
      grade: capacitySummary(factsForDeal(deal)),
      zoning: linked?.zoning || "",
      traffic: vehiclesPerDay(deal.trade_aadt) || vehiclesPerDay(linked?.aadt_count, linked?.aadt_year),
      listed: price || (deal.listed ? "Yes" : "No"),
      lead: [deal.broker, deal.firm].filter(Boolean).join(" · "),
      nda: ndaChip(deal),
      ndaId: deal.nda_id || "",
      near: nearText(deal.service_area_class ? deal : linked),
      nearShort: nearShort(deal.service_area_class ? deal : linked),
      address: displayAddress(deal.address || linked?.address),
      listingUrl: listingHref(deal.listing_url || linked?.listing_url),
      folderUrl: folderHref(deal.folder_url || linked?.folder_url),
      packageUrl: deal.package_href || "",
      ...pointOf(dealPoint(deal)),
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
      score: "—",
      tier: "",
      spare: row.acres_text || (row.acres != null ? `${row.acres} ac` : ""),
      grade: "—",
      zoning: "",
      traffic: "",
      listed: price || "Yes",
      lead: row.asking_price_source || "Listing",
    };
  }

  const listRows = [...(funnel === "pipeline"
    ? pipelineSquares.map((feature) => dealRow(feature.properties))
    : [...universePins.map((feature) => siteRow(feature.properties)), ...offMarketShown.map((feature) => siteRow(feature.properties))]
  ), ...(showUnscreened ? unscreened.filter((feature) => shownInMarket(feature.properties.city)).map((feature) => ({ ...unscreenedRow(feature.properties), ...pointOf(feature.geometry?.coordinates) })) : [])];
  const tierOn = (deal: DealProps) => (dealCategory(deal) !== "wash" || matchesOpenLandTier(deal.open_land_sqft, landTier)) && (!mapArea || (() => {
    const point = dealPoint(deal);
    return point ? inMapArea(point[0], point[1], mapArea) : false;
  })());
  const rangedPipeline = pipelineStepRows.filter((deal) => inRange(deal, ranges) && tierOn(deal));
  const landForList = stageLandRows.filter((deal) => inRange(deal, ranges) && tierOn(deal));
  const pickedIds = (params.get("pick") || "").split("|").filter(Boolean);
  const pickedSet = new Set(pickedIds);
  function dealHasScoreIssue(deal: DealProps): boolean {
    return scoreIssue({
      score: deal.score,
      economics: deal.economics_points,
      land: deal.land_points,
      power: deal.power_points,
      location: deal.location_points,
      deal: deal.deal_points,
      naEconomics: deal.business_type === "Quick lube",
    });
  }
  const listDeals = (pickedSet.size
    ? dealRows.filter((deal) => pickedSet.has(deal.deal_id) && viewDeal(deal) && dealAllowed(deal))
    : [...rangedPipeline, ...landForList]).filter((deal) => !scoreIssues || dealHasScoreIssue(deal));
  const reviewLinks: Record<string, { listing?: string; folder?: string; packageHref?: string }> = {};
  for (const deal of dealRows) {
    const listing = listingHref(deal.listing_url);
    const folder = folderHref(deal.folder_url);
    const packageHref = deal.package_href || "";
    if (listing || folder || packageHref) reviewLinks[deal.deal_id] = { listing, folder, packageHref };
  }
  const pipelineRows: PipelineRow[] = listDeals.map((deal) => {
    const linked = deal.universe_id ? siteById.get(deal.universe_id) : undefined;
    return { deal, noPin: !dealPoint(deal), zoning: linked?.zoning || "", apn: deal.apn || linked?.apn || "", point: dealPoint(deal) };
  });
  const outsideDeal = selectedDeal && !listDeals.some((deal) => deal.deal_id === selectedDeal.deal_id) ? selectedDeal : null;
  const outsideRow: PipelineRow | null = outsideDeal
    ? {
        deal: outsideDeal,
        noPin: !dealPoint(outsideDeal),
        zoning: outsideDeal.universe_id ? siteById.get(outsideDeal.universe_id)?.zoning || "" : "",
        apn: outsideDeal.apn || (outsideDeal.universe_id ? siteById.get(outsideDeal.universe_id)?.apn || "" : ""),
        point: dealPoint(outsideDeal),
      }
    : null;

  function exportList() {
    const blob = new Blob([listCsv(listRows)], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${city}-list.csv`;
    link.click();
  }

  const activeFilters: { id: string; label: string; clear: () => void }[] = [];
  if (!categories.wash) activeFilters.push({ id: "wash", label: "Car washes off", clear: () => setCategory("wash", true) });
  if (!categories.lube) activeFilters.push({ id: "lube", label: "Quick lube off", clear: () => setCategory("lube", true) });
  if (!categories.auto) activeFilters.push({ id: "auto", label: "Auto service off", clear: () => setCategory("auto", true) });
  if (categories.land) activeFilters.push({ id: "landcat", label: "Land", clear: () => setCategory("land", false) });
  if (categories.store) activeFilters.push({ id: "store", label: "C-stores", clear: () => setCategory("store", false) });
  if (reach !== "within10") activeFilters.push({ id: "reach", label: reachLabel(reach), clear: () => write({ reach: null }) });
  if (pickedIds.length) activeFilters.push({ id: "pick", label: `${pickedIds.length.toLocaleString()} selected`, clear: () => write({ pick: null }) });
  if (landTier !== "any") activeFilters.push({ id: "tier", label: tierLabel(landTier) || "Spare land", clear: () => write({ tier: null }) });
  if (verdict !== "any") activeFilters.push({ id: "verdict", label: plainVerdict(verdict), clear: () => write({ verdict: null }) });
  if (listed === "yes") activeFilters.push({ id: "listed", label: "Listed", clear: () => write({ listed: null }) });
  if (landSites) activeFilters.push({ id: "land", label: "Land sites", clear: () => write({ land: null }) });
  if (showUnscreened) activeFilters.push({ id: "newlist", label: UNSCREENED_LISTINGS_LABEL, clear: () => write({ newlist: null }) });
  if (compare) activeFilters.push({ id: "compare", label: "Reviews disagree", clear: () => write({ disagree: null }) });
  if (showDropped) activeFilters.push({ id: "ruled", label: "Ruled out", clear: () => write({ ruled: null }) });
  if (extra === "held") activeFilters.push({ id: "held", label: "Held outside the service area", clear: () => write({ extra: null }) });
  if (scoreIssues) activeFilters.push({ id: "score", label: "Score issue", clear: () => write({ score: null }) });
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
  if (allStages && funnel !== "pipeline" && !who) activeFilters.push({ id: "all-stages", label: "All stages", clear: () => write({ stage: null }) });

  function closeMenus() {
    setFiltersOpen(false);
    setMoreOpen(false);
    setUserOpen(false);
    setAlertsOpen(false);
    setMenuOpen(false);
    setUnplacedOpen(false);
  }

  const stageUnmapped = funnel === "pipeline" && (outsideGroup || (!allPipes && !pipelineWide))
    ? [...pipelineDeals, ...stageLandRows].filter((deal) => !dealPoint(deal)).length
    : 0;

  function inFunnelMarket(deal: DealProps): boolean {
    if (isProtectedId(deal.deal_id)) return false;
    if (deal.kind !== "pipeline" && deal.kind !== "land") return false;
    if (!dealAllowed(deal)) return false;
    if (!shownInMarket(deal.city)) return false;
    if (who && !partyMatch(who, deal.broker, deal.firm)) return false;
    if (query && !dealQueryHit(deal)) return false;
    return true;
  }

  function summaryText() {
    if (funnel !== "pipeline") return "";
    const stageView = !outsideGroup && !allPipes && !pipelineWide && !who;
    const home = !stageView && !outsideGroup;
    const rows = stageView || outsideGroup
      ? [...pipelineDeals, ...stageLandRows]
      : dealRows.filter((deal) => {
          if (!inFunnelMarket(deal)) return false;
          if (inReach(deal, reach)) return true;
          return showDroppedRows && deal.stage_group === "dropped";
        });
    const droppedRows = home
      ? dealRows.filter((deal) => inFunnelMarket(deal) && dealOnPipeStep(deal, "dropped", reach))
      : rows.filter((deal) => deal.stage_group === "dropped");
    return pipelineMapSummary({
      placed: rows.filter((deal) => deal.stage_group !== "dropped" && Boolean(dealPoint(deal))).length,
      dropped: droppedRows.length,
      droppedPlaced: droppedRows.filter((deal) => Boolean(dealPoint(deal))).length,
      droppedShown: outsideGroup ? false : showDroppedRows,
      droppedOnly: !outsideGroup && showDroppedRows && !dealWide && pipeStage === "dropped",
    });
  }

  function goReview(index: number) {
    const count = Math.max(reviewList.length, 1);
    const next = Math.min(Math.max(index, 0), count - 1);
    write({ review: "1", i: String(next + 1), view: null, q: null });
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
    const upcoming = reviewList.map((item) => item.siteId === siteId ? { ...item, status: "reviewed" as const } : item);
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
  const reviewFocus = inReview && reviewCurrent
    ? (reviewCoords
      ? { lng: reviewCoords[0], lat: reviewCoords[1], zoom: 15.5 }
      : { lng: (CITY_VIEW[reviewMarket] ?? CITY_VIEW.PHX).center[0], lat: (CITY_VIEW[reviewMarket] ?? CITY_VIEW.PHX).center[1], zoom: (CITY_VIEW[reviewMarket] ?? CITY_VIEW.PHX).zoom })
    : null;
  const openQueueIds = feed.filter((site) => site.status === "open").map((site) => site.siteId);
  const marketDeals = dealRows.filter(inFunnelMarket);
  const droppedInMarket = countDroppedDeals(marketDeals);
  const hiddenDropped = showDroppedRows ? 0 : droppedInMarket;
  const inReachMarket = marketDeals.filter((deal) => inReach(deal, reach));
  const shownCount = showDroppedRows
    ? inReachMarket.length + marketDeals.filter((deal) => deal.stage_group === "dropped" && !inReach(deal, reach)).length
    : inReachMarket.filter((deal) => deal.stage_group !== "dropped").length;
  const allCount = pipelineAllCount(shownCount, hiddenDropped);
  const outsideCount = countOutsideServiceArea(marketDeals);
  const reviewMarkers = inReview && !reviewMiss ? reviewList.flatMap((site, index) => {
    const deal = dealRows.find((row) => row.deal_id === site.siteId);
    const point = (deal ? dealPoint(deal) : null) || (site.lng != null && site.lat != null ? [site.lng, site.lat] as [number, number] : null);
    if (!point) return [];
    return [{ id: site.siteId, lng: point[0], lat: point[1], n: index + 1, current: site.siteId === reviewCurrent?.siteId }];
  }) : [];

  function spacePoint(): [number, number] | null {
    if (!selected) return null;
    const deal = dealRows.find((row) => row.deal_id === selected);
    if (deal) return dealPoint(deal);
    const coords = featureById.get(selected)?.geometry?.coordinates;
    return coords ? [coords[0], coords[1]] : null;
  }

  async function refreshSpaces() {
    const response = await fetch("/api/data/spaces", { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json() as { spaces?: Array<SpaceShape & { center?: { lng: number; lat: number }; lengthFt?: number; widthFt?: number; rotationDeg?: number }>; openThreads?: string[] };
    setCommentedSpaceIds(body.openThreads || []);
    setMarkedSpaces((body.spaces || []).map((row) => ({
      id: row.id,
      siteId: row.siteId,
      version: row.version,
      box: row.box?.center ? row.box : { center: row.center || { lng: 0, lat: 0 }, lengthFt: row.lengthFt || 0, widthFt: row.widthFt || 0, rotationDeg: row.rotationDeg || 0 },
      type: row.type,
      layout: row.layout,
      estSlots: row.estSlots,
      status: row.status,
      author: row.author,
    })));
  }

  async function writeSpace(space: { siteId: string; id: string; version: number; box: GroundBox; type: SpaceType; layout: SpaceLayout }, deleted = false) {
    const response = await fetch("/api/changes", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ changes: [siteSpaceChange(space, deleted)] }),
    });
    if (!response.ok) return "";
    const body = await response.json() as { results?: { entity_id?: string }[] };
    await refreshSpaces();
    return body.results?.[0]?.entity_id || space.id;
  }

  function beginMark() {
    if (mapNote) return;
    const point = spacePoint();
    if (!selected || !point) return;
    chooseBasemap("satellite");
    setShowSpaces(true);
    if (listView) write({ view: null });
    setMarking({ siteId: selected, lng: point[0], lat: point[1], nonce: Date.now() });
  }

  const recordSpaces = markedSpaces.filter((space) => space.siteId === selected);
  const spaceSqft = recordSpaces.reduce((sum, space) => sum + space.box.lengthFt * space.box.widthFt, 0);

  return (
    <div ref={bindShell} className={`shell ${marking ? "space-marking" : ""} ${tableOpen ? "table-open" : ""} ${listView && !ndaVisible && !loopsVisible ? "list-open" : ""} ${ndaVisible ? "nda-open" : ""} ${loopsVisible ? "loops-open" : ""} ${selected ? "drawer-open" : ""} ${selected ? `sheet-${sheetSnap}` : "sheet-peek"} ${inReview ? "reviewing" : ""} ${filtersOpen ? "filters-open" : ""} ${stepsOpen ? "steps-open" : ""}`} data-visible={visibleSites.length} data-city={allCities ? "all" : city} data-stage={allStages ? "all" : stage} data-pin-count={pinCount} data-list-count={funnel === "pipeline" ? pipelineRows.length : listRows.length}>
      {(filtersOpen || moreOpen || userOpen || menuOpen || unplacedOpen || alertsOpen) ? (
        <button className="backdrop" type="button" aria-label="Close menu" onClick={closeMenus} />
      ) : null}
      {alertsOpen ? <AlertSettings onClose={() => setAlertsOpen(false)} /> : null}
      {askOpen && me?.u ? (
        <AskPanel open site={askSite} onClearSite={() => setAskSite(null)} onClose={() => setAskOpen(false)} />
      ) : null}
      <CommandSearch
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        fallback={(needle) => paletteGroups(needle, dealRows, (catalog ?? features).map((feature) => feature.properties), {
          cStores: categories.store,
          land: categories.land,
          auto: categories.auto,
          lube: categories.lube,
        })}
      />
      <header className="bar">
        <div className="top">
          <Wordmark view={tableOpen ? "list" : "map"} />
          <div className="cities only-desktop" role="group" aria-label="Market">
            {(() => {
              const totals = marketCounts(dealRows.filter((deal) => deal.kind === "pipeline" || deal.kind === "land"));
              return (
                <>
                  <button type="button" className={selectedMarket === "all" ? "chip on" : "chip"} onClick={() => jump("all")}>All {totals.All.toLocaleString("en-US")}</button>
                  {CITIES.map((item) => (
                    <button key={item} className={selectedMarket === item ? "chip on" : "chip"} type="button" onClick={() => jump(item)}>
                      {item === "PHX" ? "Phoenix" : item === "LAS" ? "Las Vegas" : "Miami"} {totals[item].toLocaleString("en-US")}
                    </button>
                  ))}
                  {totals.Other > 0 ? (
                    <button type="button" className={selectedMarket === "other" ? "chip on" : "chip"} data-testid="market-other" onClick={() => jump("other")}>Other {totals.Other.toLocaleString("en-US")}</button>
                  ) : null}
                </>
              );
            })()}
          </div>
          <div className="search-wrap only-desktop">
            <button type="button" className="search scope-search" data-testid="scope-search" aria-label="Search name, address, broker, APN, id" onMouseDown={(event) => { event.preventDefault(); setCommandOpen(true); }}>Search name, address, broker, APN, id</button>
            <kbd aria-hidden="true">/</kbd>
          </div>
          <button type="button" className="chip command-open" data-testid="command-search-open" aria-label="Search everything" onClick={() => setCommandOpen(true)}>{appleShortcut ? "⌘K" : "Ctrl K"}</button>
          <div className="funnel-switch only-desktop" role="group" aria-label="Which funnel">
            <button className={funnel === "universe" ? "chip on" : "chip"} type="button" onClick={() => chooseFunnel("universe")}>Universe</button>
            <button className={funnel === "pipeline" ? "chip on" : "chip"} type="button" onClick={() => chooseFunnel("pipeline")}>Pipeline</button>
          </div>
          <div className="funnel-switch map-switch only-desktop" role="group" aria-label="Map or list">
            <button className={!listView && !inReview ? "chip on" : "chip"} type="button" onClick={() => stopReview()}>Map</button>
            <button className={listView && !inReview ? "chip on" : "chip"} type="button" onClick={() => stopReview({ view: "list" })}>List</button>
          </div>
          {me?.actionsEnabled ? (
            <button className={`review-launch ${inReview ? "on" : ""}`} type="button" onClick={() => write({ review: inReview ? null : "1", i: inReview ? null : "1", rsite: null, view: null, table: null, q: null, qmarket: inReview ? null : "all", qstage: inReview ? null : "any" })}>
              Review{(() => {
                const badge = reviewBadge({ count: queueCount, allMarkets: allCities });
                return badge.count ? <><span className="count-badge" data-testid="queue-count">{badge.count}</span>{badge.label ? <span className="split" data-testid="review-scope">{badge.label}</span> : null}</> : null;
              })()}
            </button>
          ) : null}
          {me?.u ? (
            <button
              type="button"
              className="paper-btn ask-launch"
              data-testid="ask-open"
              onClick={() => {
                if (selectedDeal) setAskSite({ id: selectedDeal.deal_id, name: selectedDeal.name || selectedDeal.deal_id });
                else if (selectedSite) setAskSite({ id: selectedSite.site_id, name: selectedSite.name || selectedSite.site_id });
                else setAskSite(null);
                setAskOpen(true);
              }}
            >
              Ask
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
                {me?.u ? <button type="button" role="menuitem" onClick={() => { setAlertsOpen(true); setUserOpen(false); }} className="menu-item">Alert settings</button> : null}
                {me?.role === "admin" ? <a role="menuitem" href="/admin/alerts">Alerts admin</a> : null}
                <button type="button" role="menuitem" onClick={logout} className="menu-item">Sign out</button>
              </div>
            ) : null}
          </div>
          <button className="phone-step only-mobile" type="button" onClick={() => { setStepsOpen(true); setMenuOpen(false); }}>
            {funnel === "pipeline"
              ? (outsideGroup ? "Outside service area" : allPipes ? "All deals" : (PIPE_STEPS.find((step) => step.id === pipeStage)?.label || "Desk screen"))
              : (allStages ? "All sites" : (STEPS.find((step) => step.id === stage)?.label || "Open land"))}
          </button>
          <button type="button" className="search mobile-search" data-testid="scope-search" aria-label="Search sites" onMouseDown={(event) => { event.preventDefault(); setCommandOpen(true); }} />
          <button className="icon-btn only-mobile" type="button" aria-expanded={menuOpen} aria-label="Menu" onClick={() => { setMenuOpen((value) => { const next = !value; if (next) setStepsOpen(false); return next; }); setFiltersOpen(false); setLayersOpen(false); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        </div>
        <div className="phone-view-row only-mobile">
          <label className="city-pick">
            <span className="sr">City</span>
            <select aria-label="City" value={allCities ? "all" : city} onChange={(event) => jump(event.target.value)} className="secondary">
              <option value="all">All markets</option>
              <option value="PHX">Phoenix</option>
              <option value="LAS">Las Vegas</option>
              <option value="MIA">Miami</option>
            </select>
          </label>
          <div className="funnel-switch map-switch" role="group" aria-label="Map or list">
            <button className={!listView && !inReview ? "chip on" : "chip"} type="button" onClick={() => stopReview()}>Map</button>
            <button className={listView && !inReview ? "chip on" : "chip"} type="button" onClick={() => stopReview({ view: "list" })}>List</button>
          </div>
          <label className="reach-pick">
            <span className="sr">Reach</span>
            <select className="secondary" aria-label="Reach" data-testid="reach-chip" value={reach} onChange={(event) => write({ reach: event.target.value === "within10" ? null : event.target.value })}>
              <option value="inside">Service area only</option>
              <option value="within5">Service area + 5 mi</option>
              <option value="within10">Service area + 10 mi</option>
            </select>
          </label>
          <button className={filtersOpen ? "chip on" : "chip"} type="button" onClick={() => { setFiltersOpen((value) => { const next = !value; if (next) setLayersOpen(false); return next; }); setMenuOpen(false); }}>Filters{activeFilters.length ? ` (${activeFilters.length})` : ""}</button>
        </div>
        <div className="funnel-switch only-mobile" role="group" aria-label="Which funnel">
          <button className={funnel === "universe" ? "chip on" : "chip"} type="button" onClick={() => chooseFunnel("universe")}>Universe</button>
          <button className={funnel === "pipeline" ? "chip on" : "chip"} type="button" onClick={() => chooseFunnel("pipeline")}>Pipeline</button>
          <button className={filtersOpen ? "chip on" : "chip"} type="button" onClick={() => { setFiltersOpen((value) => { const next = !value; if (next) setLayersOpen(false); return next; }); setMenuOpen(false); }}>Filters{activeFilters.length ? ` (${activeFilters.length})` : ""}</button>
        </div>
        <div className="funnel-row">
          <div className="funnel-sheet-head only-mobile">
            <p className="eyebrow">Steps</p>
            <button className="close" type="button" aria-label="Close steps" onClick={() => setStepsOpen(false)}><span aria-hidden="true">×</span></button>
          </div>
          <nav className={funnel === "pipeline" ? "funnel compact" : "funnel"} aria-label="Funnel">
            {funnel === "universe" ? null : (
              <>
                <span className="step">
                  <button className={allPipes && !outsideGroup ? "chip on" : "chip"} type="button" data-testid="all-stages" aria-current={allPipes && !outsideGroup ? "step" : undefined} title={allCount.title} onClick={() => write({ pstage: null, outside: null }, true)}>
                    <span>All</span>
                    <strong>{allCount.count}</strong>
                    {allCount.dropped ? <span className="split"> {allCount.dropped}</span> : null}
                  </button>
                </span>
                <span className="chev" aria-hidden="true">›</span>
              </>
            )}
            {funnel === "universe" ? STEPS.map((step, index) => {
              const listedHere = subcount(step.id, "listed");
              const dealsContacted = step.id === "universe" ? countLiveContactedDeals() : 0;
              const countedSites = labeledCount("counted", "Counted sites", count(step.id));
              const censusRows = labeledCount("census", "Census rows", step.id === "universe" ? (data?.funnel.stages.find((item) => item.id === "census")?.total ?? censusForCity) : 0);
              const mapCleared = labeledCount("map", "Map cleared", count("cleared"));
              const workbookPass = labeledCount("workbook", "Workbook PASS", data?.funnel.stages.find((item) => item.id === "verdict")?.outcomes?.PASS?.total ?? mapCleared.count);
              const note = step.id === "universe"
                ? `${countedSites.label} ${countedSites.count.toLocaleString("en-US")}. ${censusRows.label} ${censusRows.count.toLocaleString("en-US")}.`
                : step.id === "cleared"
                  ? `${mapCleared.label} ${mapCleared.count.toLocaleString("en-US")}. ${workbookPass.label} ${workbookPass.count.toLocaleString("en-US")}.`
                  : FUNNEL_NOTES[step.id];
              return (
                <Fragment key={step.id}>
                  {index > 0 ? <span className="chev" aria-hidden="true">›</span> : null}
                  <span className="step">
                    <button className={!allStages && !universeWide && stage === step.id && extra !== "listed" && extra !== "contacted" ? "chip on" : "chip"} type="button" aria-current={!allStages && !universeWide && stage === step.id && !extra ? "step" : undefined} title={note} onMouseEnter={() => setTip(note)} onMouseLeave={() => setTip("")} onClick={() => write({ stage: step.id === "land" ? null : step.id, extra: null, ruled: null }, true)}>
                      <span>{step.label}</span>
                      <strong data-count={!allStages && step.id === stage && extra == null ? visibleSites.length : filteredAt(step.id)}>{stepBadge(step.id)}</strong>
                    </button>
                    {step.id === "in_area" ? <span className="split area-split" data-testid="service-area-split">{serviceAreaSplit(sitePool.filter((site) => shownInMarket(site.city) && atStage(site, "in_area") && siteInCategories(site, links, categories)), reach)}</span> : null}
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
            }) : (
              <>
                {PIPE_STEPS.map((step, index) => {
                  const here = dealRows.filter((deal) => inFunnelMarket(deal) && dealOnPipeStep(deal, step.id, reach));
                  const parts = stepParts(here, step.id);
                  const brokerHere = here.filter((deal) => deal.broker_contacted).length;
                  const note = `${FUNNEL_NOTES[step.id]} Operating ${parts.operating.toLocaleString("en-US")}. Land ${parts.land.toLocaleString("en-US")}.${brokerHere ? ` ${brokerHere.toLocaleString("en-US")} contacted.` : ""}`;
                  const selected = !outsideGroup && !allPipes && !pipelineWide && pipeStage === step.id;
                  return (
                    <Fragment key={step.id}>
                      {index > 0 ? <span className="chev" aria-hidden="true">›</span> : null}
                      <span className="step">
                        <button className={selected ? "chip on" : "chip"} type="button" aria-current={selected ? "step" : undefined} title={note} onMouseEnter={() => setTip(note)} onMouseLeave={() => setTip("")} onClick={() => write({ pstage: step.id, outside: null }, true)}>
                          <span>{step.label}</span>
                          <strong>{parts.operating.toLocaleString("en-US")}</strong>
                          {parts.land ? <span className="split">{parts.land.toLocaleString("en-US")} land</span> : null}
                        </button>
                      </span>
                    </Fragment>
                  );
                })}
                <button className={outsideGroup ? "aside on" : "aside"} type="button" data-testid="outside-service-area" aria-current={outsideGroup ? "step" : undefined} title={FUNNEL_NOTES.outside} onMouseEnter={() => setTip(FUNNEL_NOTES.outside)} onMouseLeave={() => setTip("")} onClick={() => write({ outside: outsideGroup ? null : "1", pstage: null }, true)}>
                  <span>Outside service area</span>
                  <strong>{outsideCount.toLocaleString()}</strong>
                </button>
              </>
            )}
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
              const everywhere = sites.filter((site) => site.city === city && atStage(site, "universe") && passesChips(site, false)).length;
              const here = sites.filter((site) => atStage(site, stage) && passesChips(site, false)).length;
              const more = everywhere - here;
              if (more <= 0) return null;
              return <button className="aside" type="button" onClick={() => write({ stage: "universe" }, true)}>{more.toLocaleString()} more at other steps</button>;
            })()
          ) : null}
          {summaryText() ? (
            <span className="summary-chip" title={SUMMARY_NOTES.pipeline}>
              {summaryText()}
            </span>
          ) : null}
          {stageUnmapped > 0 ? <span className="summary-chip" data-testid="unmapped-note">{stageUnmapped.toLocaleString()} without a location</span> : null}
          {data.funnel.workbook_as_of ? <span className="summary-chip as-of">Data as of {data.funnel.workbook_as_of}</span> : null}
          <button className={`tool only-desktop ${filtersOpen ? "on" : ""}`} type="button" aria-expanded={filtersOpen} onClick={() => { setFiltersOpen((value) => { const next = !value; if (next) setLayersOpen(false); return next; }); setMoreOpen(false); setUserOpen(false); setUnplacedOpen(false); }}>
            Filters
            {activeFilters.length ? <span className="count-badge">{activeFilters.length}</span> : null}
          </button>
          <div className="more-wrap only-desktop">
            <button className={`tool ${moreOpen ? "on" : ""}`} type="button" aria-expanded={moreOpen} onClick={() => { setMoreOpen((value) => !value); setFiltersOpen(false); setUserOpen(false); setUnplacedOpen(false); }}>More</button>
            {moreOpen ? (
              <div className="menu" role="menu">
                <button type="button" onClick={() => void copyLink()} className="menu-item">{copied ? "Link copied" : "Copy link"}</button>
                <ActionsMenuButtons close={() => setMoreOpen(false)} />
                <button type="button" data-testid="nda-queue-open" onClick={() => { setMoreOpen(false); write(ndaVisible ? { nda: null } : { nda: "1", loops: null, view: null, table: null, review: null, i: null }); }} className="menu-item">NDA queue</button>
                {loopsAllowed ? <button type="button" data-testid="open-loops-open" onClick={() => { setMoreOpen(false); write(loopsVisible ? { loops: null } : { loops: "1", nda: null, view: null, table: null, review: null, i: null }); }} className="menu-item">Open loops</button> : null}
                <button type="button" onClick={() => { setGuideOpen(true); setMoreOpen(false); }} className="menu-item">How to read this</button>
                {changesNote ? <p className="menu-note">{changesNote}</p> : null}
              </div>
            ) : null}
          </div>
        </div>
        {activeFilters.length ? (
          <div className="active-row" aria-label="Active filters">
            {activeFilters.map((item) => (
              <button key={item.id} className={item.id === "reach" ? "removable only-desktop" : "removable"} type="button" onClick={item.clear}>
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
              <button type="button" className="close" aria-label="Close filters" onClick={() => setFiltersOpen(false)}><span aria-hidden="true">×</span></button>
            </div>
            <h3>Categories</h3>
            <div className="cat-row">
              <label title={CATEGORY_NOTES.wash}>
                <input className="check" type="checkbox" data-testid="wash-category" checked={categories.wash} onChange={() => setCategory("wash", !categories.wash)} />
                <span>Car washes<span className="layer-meta">{CATEGORY_NOTES.wash}</span></span>
              </label>
              <label title={CATEGORY_NOTES.lube}>
                <input className="check" type="checkbox" data-testid="lube-category" checked={categories.lube} onChange={() => setCategory("lube", !categories.lube)} />
                <span>{QUICK_LUBE_LABEL}<span className="layer-meta">{CATEGORY_NOTES.lube}</span></span>
              </label>
              <label title={CATEGORY_NOTES.auto}>
                <input className="check" type="checkbox" data-testid="auto-category" checked={categories.auto} onChange={() => setCategory("auto", !categories.auto)} />
                <span>Auto service<span className="layer-meta">{CATEGORY_NOTES.auto}</span></span>
              </label>
              <label title={CATEGORY_NOTES.land}>
                <input className="check" type="checkbox" data-testid="land-category" checked={categories.land} onChange={() => setCategory("land", !categories.land)} />
                <span>Land<span className="layer-meta">{CATEGORY_NOTES.land}</span></span>
              </label>
              <label title={CATEGORY_NOTES.store}>
                <input className="check" type="checkbox" data-testid="cstore-category" checked={categories.store} onChange={() => setCategory("store", !categories.store)} />
                <span>C-stores<span className="layer-meta">{CATEGORY_NOTES.store}</span></span>
              </label>
            </div>
            <h3>Score</h3>
            <label title="Stored total disagrees with the parts, or Economics has no inputs.">
              <input className="check" type="checkbox" data-testid="score-issue" checked={scoreIssues} onChange={() => write({ score: scoreIssues ? null : "issue", funnel: "pipeline", view: "list" })} />
              <span>Score issue</span>
            </label>
            <h3>Broker or firm</h3>
            <input
              className="field party-filter"
              aria-label="Broker or firm"
              placeholder="Name or firm"
              value={who}
              onChange={(event) => {
                const next = event.target.value;
                if (!next.trim()) {
                  write({ who: null });
                  return;
                }
                write({ who: next, funnel: "pipeline", tab: "pipeline", pstage: null, city: "all", view: "list" });
              }}
            />
            <div className="only-desktop">
              <h3>Reach</h3>
              <p className="filter-note">Service area only, plus 5 miles outside, or plus 10 miles outside. Farther than 10 miles stays off this view. Nothing is dropped.</p>
              <div className="segmented" role="group" aria-label="Reach" data-testid="reach-filter">
                {([
                  ["inside", "Service area only"],
                  ["within5", "Service area + 5 mi"],
                  ["within10", "Service area + 10 mi"],
                ] as const).map(([item, label]) => (
                  <button key={item} type="button" className={`segmented ${reach === item ? "on" : ""}`} onClick={() => write({ reach: item === "within10" ? null : item })}>{label}</button>
                ))}
              </div>
            </div>
            <h3>Open land</h3>
            <p className="filter-note">{SPARE_LAND_NOTE}</p>
            <div className="segmented" role="group" aria-label="Open land">
              {([["any", "Any"], ["L10", "10k+ sq ft"], ["L4", "4k+ sq ft"]] as const).map(([item, label]) => (
                <button key={item} type="button" className={`segmented ${landTier === item ? "on" : ""}`} onClick={() => write({ tier: item === "any" ? null : item })}>{label}</button>
              ))}
            </div>
            {funnel === "universe" ? (
              <>
                <h3>Verdict</h3>
                <div className="segmented" role="group" aria-label="Verdict">
                  {([
                    ["any", "All"],
                    ["PASS", "Cleared"],
                    ["MAYBE", "Possible"],
                    ["UNRESOLVED", "Unresolved"],
                  ] as const).map(([item, label]) => (
                    <button key={item} type="button" className={`segmented ${verdict === item ? "on" : ""}`} onClick={() => write({ verdict: item === "any" ? null : item })}>{label}</button>
                  ))}
                </div>
                <div className="filter-checks">
                  <label><input className="check" type="checkbox" checked={compare} onChange={() => write({ disagree: compare ? null : "1" })} /> Reviews disagree</label>
                  {dropCount > 0 ? <label><input className="check" type="checkbox" checked={showDropped} onChange={() => write({ ruled: showDropped ? null : "1" })} /> Ruled out ({dropCount.toLocaleString()})</label> : null}
                  {heldCount > 0 ? <label><input className="check" type="checkbox" checked={extra === "held"} onChange={() => write({ stage: null, extra: extra === "held" ? null : "held" })} /> Held outside the service area ({heldCount.toLocaleString()})</label> : null}
                </div>
              </>
            ) : null}
            <h3>Listings</h3>
            <div className="cat-row">
              <label title={UNSCREENED_LISTINGS_NOTE}>
                <input className="check" type="checkbox" data-testid="unscreened-listings" checked={showUnscreened} onChange={(event) => write({ newlist: event.target.checked ? "1" : null })} />
                <span>
                  {UNSCREENED_LISTINGS_LABEL}
                  <span className="layer-meta">{UNSCREENED_LISTINGS_NOTE}</span>
                </span>
              </label>
            </div>
            {listView && funnel === "pipeline" ? (
              <>
                <h3>Column ranges</h3>
                <p className="filter-note">Minimum and maximum for the pipeline list. These do not change the map.</p>
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
                      <input className="field" aria-label={`${label} minimum`} placeholder="Min" inputMode="decimal" value={ranges[minKey] ?? ""} onChange={(event) => {
                        const raw = event.target.value.trim();
                        const value = raw === "" ? null : Number(raw);
                        write(rangeQuery({ ...ranges, [minKey]: value != null && Number.isFinite(value) ? value : null }));
                      }} />
                      <input className="field" aria-label={`${label} maximum`} placeholder="Max" inputMode="decimal" value={ranges[maxKey] ?? ""} onChange={(event) => {
                        const raw = event.target.value.trim();
                        const value = raw === "" ? null : Number(raw);
                        write(rangeQuery({ ...ranges, [maxKey]: value != null && Number.isFinite(value) ? value : null }));
                      }} />
                    </label>
                  ))}
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
              <button type="button" className="close" aria-label="Close menu" onClick={() => setMenuOpen(false)}><span aria-hidden="true">×</span></button>
            </div>
            <div className="funnel-switch segment" role="group" aria-label="Which funnel">
              <button className={funnel === "universe" ? "chip on" : "chip"} type="button" onClick={() => chooseFunnel("universe")}>Universe</button>
              <button className={funnel === "pipeline" ? "chip on" : "chip"} type="button" onClick={() => chooseFunnel("pipeline")}>Pipeline</button>
            </div>
            <div className="menu-group" role="group" aria-label="Find">
              <button type="button" onClick={() => { setFiltersOpen(true); setLayersOpen(false); setMenuOpen(false); }} className="menu-item">Filters{activeFilters.length ? ` (${activeFilters.length})` : ""}</button>
            </div>
            <div className="menu-group" role="group" aria-label="Tools">
              <button type="button" onClick={() => void copyLink()} className="menu-item">{copied ? "Link copied" : "Copy link"}</button>
              <ActionsMenuButtons close={() => setMenuOpen(false)} />
              <button type="button" data-testid="nda-queue-open" onClick={() => { setMenuOpen(false); write(ndaVisible ? { nda: null } : { nda: "1", loops: null, view: null, table: null, review: null, i: null }); }} className="menu-item">NDA queue</button>
              {loopsAllowed ? <button type="button" data-testid="open-loops-open" onClick={() => { setMenuOpen(false); write(loopsVisible ? { loops: null } : { loops: "1", nda: null, view: null, table: null, review: null, i: null }); }} className="menu-item">Open loops</button> : null}
              <button type="button" onClick={() => { setGuideOpen(true); setMenuOpen(false); }} className="menu-item">How to read this</button>
              {funnel === "pipeline" && unplacedDeals.length > 0 ? (
                <button type="button" onClick={() => { setUnplacedOpen(true); setMenuOpen(false); }} className="menu-item">Not on the map, all stages ({unplacedDeals.length.toLocaleString()})</button>
              ) : null}
            </div>
            {changesNote ? <p className="menu-note">{changesNote}</p> : null}
            <div className="menu-group menu-account">
              {me?.u ? <p className="menu-note menu-identity"><span>Signed in</span>{me.u}</p> : null}
              {me?.role === "admin" ? <a href="/admin">Accounts</a> : null}
              {me?.u ? <button type="button" onClick={() => { setAlertsOpen(true); setMenuOpen(false); }} className="menu-item">Alert settings</button> : null}
              {me?.role === "admin" ? <a href="/admin/alerts">Alerts admin</a> : null}
              <button type="button" onClick={logout} className="menu-item">Sign out</button>
            </div>
          </div>
        ) : null}
        {withheldOpen ? (
          <div className="popover" role="dialog" aria-label="Address withheld">
            <div className="popover-head">
              <h2>{withheldHere.length.toLocaleString()} address withheld</h2>
              <button type="button" className="close" aria-label="Close" onClick={() => setWithheldOpen(false)}><span aria-hidden="true">×</span></button>
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
              <button type="button" className="close" aria-label="Close" onClick={() => setUnplacedOpen(false)}><span aria-hidden="true">×</span></button>
            </div>
            <ul className="unplaced-list">
              {unplacedDeals.map((deal) => (
                <li key={deal.deal_id}>
                  <button type="button" className="text-link" onClick={() => { choose(deal.deal_id); setUnplacedOpen(false); }}>{deal.name || deal.address || deal.deal_id}</button>
                  {" · "}{stageTitle(deal.stage_group)}
                  {" · "}<NdaChip deal={deal} signedIn={Boolean(me)} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </header>
      <ActionsQuietNotice />
      {inReview && reviewMiss ? (
        <div className="review-bar review-site-empty" data-testid="review-site-empty" role="status">
          <p>No review items for {reviewScopeName}</p>
          <button type="button" className="review-exit" onClick={() => stopReview()}>Back to map</button>
        </div>
      ) : null}
      {inReview && me?.actionsEnabled && !reviewMiss && (!reviewScoped || reviewQueueReady) ? (
        <ReviewBar
          index={reviewIndex}
          total={reviewList.length}
          reviewed={feed.filter((site) => site.status === "reviewed").length}
          summary={filterSummary}
          siteId={reviewCurrent?.siteId || ""}
          followed={Boolean(reviewCurrent?.followed)}
          onPrev={() => goReview(reviewIndex - 1)}
          onNext={() => goReview(reviewIndex + 1)}
          onReviewed={() => void markCurrentReviewed()}
          onExit={() => stopReview()}
          onOpenFeed={() => setFeedSheet(true)}
          onSnooze={snoozeCurrent}
          reasons={reviewCurrent?.reasons || []}
          firstVisit={Boolean(reviewCurrent?.firstVisit)}
          reviewedAt={reviewCurrent?.reviewedAt || ""}
          stageGroup={dealRows.find((deal) => deal.deal_id === reviewCurrent?.siteId)?.stage_group}
          stage={dealRows.find((deal) => deal.deal_id === reviewCurrent?.siteId)?.stage}
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
                if (!reviewing && "qmarket" in next && next.qmarket === city) next.qmarket = null;
                write(next);
              }}
            />
          )}
        />
      ) : null}

      <div className="map-stage">
        <ActionsDialogs />
        <CommentGridHost />
        {inReview && !caughtUp && !reviewMiss && (!reviewScoped || reviewQueueReady) ? (
          <ReviewRail sites={reviewList.map((site) => ({ ...site, score: displayScore(dealRows.find((deal) => deal.deal_id === site.siteId || deal.universe_id === site.siteId)?.score) || "—" }))} currentId={reviewCurrent?.siteId || ""} onPick={goReview} links={reviewLinks} />
        ) : null}
        {inReview && reviewMiss ? (
          <aside className="review-rail" data-testid="review-rail" aria-label="Review inbox">
            <p className="review-empty">No review items for {reviewScopeName}</p>
          </aside>
        ) : null}
        {inReview && caughtUp && !reviewMiss ? (
          <div className="review-done" data-testid="queue-empty">
            <p>All caught up</p>
            <button type="button" onClick={() => stopReview()} className="menu-item">Back to map</button>
          </div>
        ) : null}
        {inReview && reviewCurrent && !reviewCoords ? <p className="review-noloc" data-testid="review-noloc">No exact location yet</p> : null}
        {undo ? (
          <div className="review-toast" role="status">
            Marked reviewed.
            <button type="button" onClick={() => void undoReviewMark()} className="menu-item">Undo</button>
          </div>
        ) : null}
        {feedSheet ? (
          <ReviewFeedSheet sites={reviewList.map((site) => ({ ...site, score: displayScore(dealRows.find((deal) => deal.deal_id === site.siteId || deal.universe_id === site.siteId)?.score) || "—" }))} currentId={reviewCurrent?.siteId || ""} onPick={goReview} onClose={() => setFeedSheet(false)} links={reviewLinks} />
        ) : null}
        <PanelBoundary name="Map">
        <MapView
          sites={funnel === "pipeline" ? (showUniverse ? pipelineSites : []) : (showUniverse ? shownFeatures : [])}
          coverage={funnel !== "pipeline" && showUniverse ? {
            listed: shownFeatures.length,
            missingPoint: shownFeatures.filter((feature) => !feature.geometry).length,
          } : null}
          deals={drawnDeals}
          fitPoints={[
            ...((funnel === "pipeline" ? [] : shownFeatures).flatMap((feature) => feature.geometry ? [feature.geometry.coordinates as [number, number]] : [])),
            ...drawnDeals.flatMap((feature) => feature.geometry ? [feature.geometry.coordinates as [number, number]] : []),
          ]}
          area={mapArea}
          onArea={(next) => write(areaQuery(next))}
          overlayPoints={overlayPoints}
          washPoints={washPoints}
          gridFeatures={gridFeatures.filter((feature) => feature.properties.deal_id === selected || (feature.properties.site_id && feature.properties.site_id === selected))}
          areas={data.areas.features}
          depots={data.depots.features}
          parcels={data.parcels.features}
          offMarket={offMarketShown}
          unscreened={showUnscreened ? unscreened.filter((feature) => shownInMarket(feature.properties.city) && feature.geometry) : []}
          selectedId={selected}
          showAreas={showAreas}
          showDepots={showDepots}
          showSites={showUniverse}
          showRings={showRings}
          focusLng={focus.center[0]}
          focusLat={focus.center[1]}
          focusZoom={focus.zoom}
          fitAll={fitAll}
          reviewMarkers={reviewMarkers}
          queueIds={openQueueIds}
          reviewFocus={reviewFocus}
          pinLabel={pinLabel}
          onPinLabel={setPinLabel}
          basemap={basemap}
          onBasemap={chooseBasemap}
          onShowList={() => write({ view: "list" })}
          onRingsOutside={setRingsOutside}
          registerFrameRings={registerFrameRings}
          onSelect={(id) => {
            if (inReview) {
              const at = reviewList.findIndex((site) => site.siteId === id);
              if (at >= 0) {
                goReview(at);
                return;
              }
            }
            if (dealRows.some((deal) => deal.deal_id === id)) setTableTab(dealRows.find((deal) => deal.deal_id === id)?.kind === "land" ? "land" : "pipeline");
            choose(id);
          }}
          spaceShapes={markedSpaces}
          showSpaces={showSpaces}
          spaceDrawing={Boolean(marking)}
          spaceFly={commentFly || marking}
          selectedSpaceId={pickedSpace}
          spaceNames={spaceNames}
          commentedSpaceIds={commentedSpaceIds}
          threadSpaceId={threadSpaceId}
          onThreadClose={() => setThreadSpaceId("")}
          onSpaceSelect={setPickedSpace}
          onSpaceCreate={(box) => {
            if (!marking) return;
            void writeSpace({ siteId: marking.siteId, id: "", version: 0, box, type: "excess_parking", layout: "stalls_90" }).then((id) => {
              if (id) setPickedSpace(id);
            });
          }}
          onSpaceChange={(space) => {
            void writeSpace(space);
          }}
          onSpaceDelete={(space) => {
            void writeSpace(space, true).then((id) => {
              if (id) setPickedSpace("");
            });
          }}
          onSpaceDone={() => { setMarking(null); setPickedSpace(""); }}
          canDrawLots={Boolean(me && spacePoint())}
          onDrawLots={beginMark}
          onMapFailed={setMapNote}
          onBounds={(bounds, meta) => {
            if (!bounds.getWest || !bounds.getSouth || !bounds.getEast || !bounds.getNorth) return;
            const west = bounds.getWest();
            const south = bounds.getSouth();
            const east = bounds.getEast();
            const north = bounds.getNorth();
            if (![west, south, east, north].every((value) => Number.isFinite(value))) return;
            setLiveArea({ kind: "polygon", points: [[west, south], [east, south], [east, north], [west, north]] });
            if (meta?.user && listView && !window.matchMedia("(max-width: 767px)").matches) setFollowArea(true);
          }}
        />
        </PanelBoundary>
        {handoffCopy ? <p className="empty-map" role="status">{handoffCopy}</p> : null}
        {funnel === "universe" && !listView && shownFeatures.length === 0 ? (
          <p className="empty-map">{listedStepEmpty
            ? `${STEPS.find((step) => step.id === stage)?.label || "This step"} has no listed sites. Universe has ${subcount("universe", "listed").toLocaleString()} listed. Service area has ${subcount("in_area", "listed").toLocaleString()} listed.`
            : compare ? `No disagreements in ${city === "PHX" ? "Phoenix" : city === "LAS" ? "Las Vegas" : "Miami"}.` : query ? "No matches." : "Nothing to show for this step."}</p>
        ) : null}
        {listedStepEmpty && !handoffStep && !listView ? (
          <div className="empty-actions">
            <button type="button" onClick={() => write({ stage: "universe", listed: "yes" })} className="menu-item">Show Universe listed</button>
            <button type="button" onClick={() => write({ stage: "in_area", listed: "yes" })} className="menu-item">Show Service area listed</button>
          </div>
        ) : null}
        {!listView && !selected && data ? (
          <aside className="phone-peek" data-testid="phone-peek">
            <span className="sheet-grab" aria-hidden="true" />
            <div>
              {summaryText() ? <strong>{summaryText()}</strong> : null}
              {data.funnel.workbook_as_of ? <p>Data as of {data.funnel.workbook_as_of}</p> : null}
            </div>
            <button type="button" aria-label="Open the list" onClick={() => write({ view: "list" })} className="menu-item">List</button>
          </aside>
        ) : null}
        {ndaVisible ? <NdaQueue onOpen={choose} onClose={() => write({ nda: null })} /> : null}
        {loopsVisible ? <OpenLoops onOpen={choose} onClose={() => write({ loops: null })} /> : null}
        <PanelBoundary name="List">
        {listView && !ndaVisible && !loopsVisible && funnel === "pipeline" ? (
          <PipelineList
            rows={pipelineRows}
            outsideRow={outsideRow}
            unreadIds={openQueueIds}
            columns={pipelineColumns}
            selectedId={selected}
            sort={{ id: pipelineSortId, desc: sortDesc }}
            signedIn={Boolean(me?.u)}
            canAct={Boolean(me?.actionRole && canWrite(me.actionRole as ActionRole))}
            onSort={(id, desc) => write({ sort: desc === undefined ? "none" : `${id}:${desc ? "desc" : "asc"}` })}
            onOpen={choose}
            onDismiss={() => choose(null)}
            onShowMap={(id) => { setSelected(id); write({ view: null, site: id }); }}
            sortQuery={params.has("sort") ? params.get("sort") : null}
            columnSeed={params.has("cols") ? pipelineColumns : null}
            userId={me?.u || ""}
            mapArea={mapAreaLive}
            onSearchArea={() => setFollowArea(true)}
            onClearArea={() => setFollowArea(false)}
            onColumns={(next) => {
              const defaults = defaultColumnIds().join(",");
              const value = next.join(",");
              write({ cols: value === defaults ? null : value });
            }}
            onResetColumns={() => write({ cols: null, sort: null })}
            onBroker={(name) => write({ who: name, funnel: "pipeline", tab: "pipeline", pstage: null, city: "all", view: "list" })}
            onCompare={(ids) => write({ compare: ids.slice(0, 4).join("|"), view: "list" })}
            onCopyLink={async (ids) => {
              const next = new URL(window.location.href);
              next.searchParams.set("view", "list");
              next.searchParams.set("funnel", "pipeline");
              next.searchParams.set("pick", ids.join("|"));
              next.searchParams.delete("pstage");
              await navigator.clipboard.writeText(next.toString());
            }}
            onComment={(ids, body) => postSelection(ids, (id) => ({ targetKind: "deal", targetId: id, body }))}
            onDrop={(ids, reason) => postSelection(ids, (id) => ({
              targetKind: "deal",
              targetId: id,
              field: "proposed_next_step",
              detail: "knock_off",
              proposedValue: "Dropped",
              reason,
            }), "/api/actions/suggestions")}
          />
        ) : listView && !ndaVisible && !loopsVisible ? (
          <ListView
            rows={listRows}
            selectedId={selected}
            sort={{ id: sortKey, desc: sortDesc }}
            onSort={(id, desc) => write({ sort: desc === undefined ? "none" : `${id}:${desc ? "desc" : "asc"}` })}
            onOpen={choose}
            onDismiss={() => choose(null)}
            onShowMap={(id) => { setSelected(id); write({ view: null, site: id }); }}
            onExport={exportList}
            note={handoffCopy}
            signedIn={Boolean(me?.u)}
            userId={me?.u || ""}
            sortQuery={params.has("sort") ? params.get("sort") : null}
            mapArea={mapAreaLive}
            onSearchArea={() => setFollowArea(true)}
            onClearArea={() => setFollowArea(false)}
          />
        ) : null}
        </PanelBoundary>
        <aside className={`layers ${layersOpen ? "open" : ""}`} data-testid="layers-panel">
          {layersOpen ? (
            <>
              <div className="layers-bar">
                <p className="eyebrow">Layers</p>
                <button type="button" className="close" aria-label="Close layers" onClick={() => setLayersOpen(false)}><span aria-hidden="true">×</span></button>
              </div>
              <div className="layers-body">
                <div className="only-mobile">
                  <p className="eyebrow">Basemap</p>
                  <div className="segmented" role="group" aria-label="Basemap" data-testid="basemap">
                    <button type="button" className={`segmented ${basemap === "satellite" ? "on" : ""}`} onClick={() => chooseBasemap("satellite")}>Satellite</button>
                    <button type="button" className={`segmented ${basemap === "positron" ? "on" : ""}`} onClick={() => chooseBasemap("positron")}>Map</button>
                  </div>
                </div>
                <p className="eyebrow">Pin labels</p>
                <div className="segmented pin-modes" role="group" aria-label="Pin labels">
                  {([["none", "Off", LAYER_TITLES.pinOff], ["asking", "Price", LAYER_TITLES.pinPrice], ["acres", "Acres", LAYER_TITLES.pinAcres], ["peracre", "$/ac", LAYER_TITLES.pinPerAcre]] as const).map(([id, label, title]) => (
                    <button key={id} type="button" className={`segmented ${pinLabel === id ? "on" : ""}`} title={title} onClick={() => setPinLabel(id)}>{label}</button>
                  ))}
                </div>
                <p className="eyebrow">On the map</p>
                {funnel === "universe" ? (
                  <label className="layer-row" title={LAYER_TITLES.pipeline}>
                    <input className="check" type="checkbox" checked={dealsOn} onChange={(event) => write({ deals: event.target.checked ? null : "0" })} />
                    <span className="layer-mark"><i className="pin-sample circle" /></span>
                    Pipeline deals
                  </label>
                ) : (
                  <label className="layer-row" title={LAYER_TITLES.universe}>
                    <input className="check" type="checkbox" checked={pinsOn} onChange={(event) => write({ pins: event.target.checked ? null : "0" })} />
                    <span className="layer-mark"><i className="pin-sample diamond" /></span>
                    Universe sites
                  </label>
                )}
                <label className="layer-row" title={LAYER_TITLES.dropped}>
                  <input className="check" type="checkbox" checked={showDroppedDeals} onChange={(event) => write({ dropped: event.target.checked ? "1" : null })} />
                  <span className="layer-mark"><i className="swatch stage-dropped" /></span>
                  Dropped deals
                </label>
                <label className="layer-row" title="Lots drawn on the satellite view. Slot counts stay estimated until someone checks them.">
                  <input className="check" type="checkbox" checked={showSpaces} onChange={(event) => setShowSpaces(event.target.checked)} data-testid="spaces-layer" />
                  <span className="layer-mark"><i className="swatch l10" /></span>
                  Available lots
                </label>
                <p className="eyebrow">Context</p>
                <label className="layer-row" title={LAYER_TITLES.areas}>
                  <input className="check" type="checkbox" checked={showAreas} onChange={(event) => write({ areas: event.target.checked ? null : "0" })} />
                  <span className="layer-mark"><i className="swatch current-area" /></span>
                  Service areas
                </label>
                <label className="layer-row" title={LAYER_TITLES.depots}>
                  <input className="check" type="checkbox" checked={showDepots} onChange={(event) => write({ depots: event.target.checked ? null : "0" })} />
                  <span className="layer-mark"><i className="pin-sample depot" /></span>
                  Depots
                </label>
                <label className="layer-row layer-sub" title={LAYER_TITLES.rings} onMouseEnter={(event) => setRingCursor({ x: event.clientX, y: event.clientY })} onMouseLeave={() => setRingCursor(null)}>
                  <input className="check" type="checkbox" checked={showRings} onChange={(event) => write({ rings: event.target.checked ? "1" : null })} />
                  <span className="layer-mark"><i className="pin-sample line" /></span>
                  <span className="layer-nest">Depot rings</span>
                </label>
                <p className="eyebrow">Area data</p>
                {(["traffic", "population", "growth", "income", "washes"] as const).map((id) => {
                  const item = OVERLAYS.find((entry) => entry.id === id);
                  if (!item) return null;
                  return (
                    <label key={item.id} className="layer-row" title={LAYER_TITLES[item.id]}>
                      <input className="check" type="checkbox" checked={overlaysOn.includes(item.id)} onChange={() => toggleOverlay(item.id)} />
                      <span className="layer-mark" />
                      {item.label}
                    </label>
                  );
                })}
              </div>
            </>
          ) : (
            <button type="button" className="paper-btn" onClick={() => { setLayersOpen(true); setFiltersOpen(false); setMenuOpen(false); }}>Layers</button>
          )}
        </aside>
        {!listView ? (
          <div className="map-corner">
            {ringsOutside ? (
              <div className="rings-outside" role="status">
                <p>5- and 10-mile rings are outside this view.</p>
                <button type="button" className="paper-btn" onClick={() => frameRings.current?.()}>Show rings</button>
              </div>
            ) : null}
            {(() => {
              const missing = funnel === "pipeline"
                ? pipelineStepRows.length - pipelineSquares.length
                : visibleSites.filter((site) => !featureById.get(site.site_id)?.geometry).length + (landSites ? landDeals.filter((deal) => !dealPoint(deal)).length : 0);
              return missing > 0 ? <p className="location-note">{missing.toLocaleString()} without a location</p> : null;
            })()}
            <aside className="map-key" aria-label="Key">
              <ul>
                <li><i className="swatch cleared" /> Cleared</li>
                <li><i className="swatch possible" /> Possible</li>
                <li><i className="swatch unresolved" /> Unresolved</li>
                <li><i className="swatch held" /> Held</li>
                <li><i className="swatch l10" /> 10k+ sq ft</li>
                <li><i className="swatch l4" /> 4k+ sq ft</li>
                <li title={NEAR_TIP}><i className="swatch near" /> Outside, nearby</li>
              </ul>
            </aside>
          </div>
        ) : null}
        {tip ? <p className="tip">{tip}</p> : null}
        {guideOpen ? (
          <aside className="guide">
            <button className="close" type="button" aria-label="Close" onClick={() => setGuideOpen(false)}><span aria-hidden="true">×</span></button>
            <h2>How to read this</h2>
            <p>The universe funnel starts with one site for each place. The hover note on Universe says how many census records were merged to get there. Each later step keeps only the sites that passed the step before it.</p>
            <p>When a step has sites on the market, a count beside it lists them. Click that count to show those sites. A larger site has about 10,000 sq ft of open land. A smaller site has about 4,000. Open land is leftover land on an operating wash. It is not a vacant parcel.</p>
            <p>Filters chooses the working set. Car washes, quick lube, and auto service are on. Land parcels, such as LAND-PHX, and c-stores stay off until you turn them on. The header, the list, and the map all follow that set.</p>
            <p>Power sits beside open land. It lists the measured facts on file, with the source and confidence for each. A blank layer stays blank.</p>
            <p>Deals contacted, beside Universe, counts deals in the categories you have on, in this city, with an outbound email or call on file. Dropped deals stay out of that count.</p>
            <p>Held sites are cleared on the land, but they sit outside the current service area. They are not counted in the in-area steps.</p>
            <ul>
              {STATUS_NOTES.map((item) => <li key={item.id}><strong>{item.label}.</strong> {item.note}</li>)}
            </ul>
          </aside>
        ) : null}
        <PanelBoundary name="Record">
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
            onOpenReview={me?.actionsEnabled ? () => openInReview(selectedDeal.deal_id) : undefined}
            compared={compareIds.includes(selectedDeal.deal_id)}
            sheet={sheet}
            onSwipe={inReview ? (direction) => goReview(direction === "next" ? reviewIndex + 1 : reviewIndex - 1) : undefined}
            signedIn={Boolean(me)}
            spaceCount={recordSpaces.length}
            spaceSlots={recordSpaces.reduce((sum, space) => sum + space.estSlots, 0)}
            spaceSqft={spaceSqft}
            onMarkSpace={me ? beginMark : undefined}
            spaceNote={mapNote}
            extras={<RecordActions kind="deal" id={selectedDeal.deal_id} />}
            figuresReady={Boolean(selectedDeal) || figuresReady}
            outsideFilter={Boolean(outsideDeal) || !dealInCategories(selectedDeal, categories)}
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
            compared={compareIds.includes(selectedSite.site_id)}
            onOpenReview={me?.actionsEnabled ? () => openInReview(selectedSite.site_id) : undefined}
            sameOwner={sites.filter((site) => site.site_id !== selectedSite.site_id && site.owner && site.owner === selectedSite.owner).slice(0, 6)}
            onClose={() => choose(null)}
            sheet={sheet}
            extras={<RecordActions kind="site" id={selectedSite.site_id} />}
            signedIn={Boolean(me)}
            spaceCount={recordSpaces.length}
            spaceSlots={recordSpaces.reduce((sum, space) => sum + space.estSlots, 0)}
            spaceSqft={spaceSqft}
            onMarkSpace={me ? beginMark : undefined}
            spaceNote={mapNote}
            figuresReady={figuresReady}
            outsideFilter={Boolean(selectedSite && !siteInCategories(selectedSite, links, categories))}
            related={relatedPanel({ id: selectedSite.site_id, kind: "site", name: selectedSite.name, address: selectedSite.address, apn: selectedSite.apn })}
          />
        ) : null}
        </PanelBoundary>
        <PanelBoundary name="Compare">
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
            signedIn={Boolean(me)}
            onRemove={(id) => setCompared(id, false)}
            onClose={() => write({ compare: null, slist: null })}
          >
            {compareIds.length >= 2 && me?.u ? (
              <button type="button" className="paper-btn" onClick={() => void fetch("/api/actions/views", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ name: `Compare ${compareIds.length}`, query: `compare=${compareIds.join("|")}`, scope: "personal" }),
              })}>Save view</button>
            ) : null}
          </CompareTray>
        ) : null}
        </PanelBoundary>
      </div>
      {tableOpen ? (
        <PanelBoundary name="Table">
        <section className="dock">
          <div className="dock-tabs">
            <button className="paper-btn only-mobile" type="button" onClick={() => write({ table: null })}>Map</button>
            {(["universe", "pipeline", "land"] as const).map((tab) => (
              <button key={tab} className={tableTab === tab ? "chip on" : "chip"} type="button" onClick={() => setTableTab(tab)}>
                {tab === "universe" ? "Universe" : tab === "pipeline" ? "Pipeline" : "Land"}
              </button>
            ))}
          </div>
          {tableTab === "universe" ? <SiteTable rows={visibleSites} deals={dealRows} selectedId={selected} onSelect={choose} activity={activity} sorting={sortParam ? [{ id: sortParam.split(":")[0], desc: sortParam.endsWith(":desc") }] : []} onSortingChange={(next) => write({ sort: next[0] ? `${next[0].id}:${next[0].desc ? "desc" : "asc"}` : null })} /> : null}
          {tableTab === "pipeline" ? <DealTable rows={pipelineDeals} selectedId={selected} onSelect={choose} activity={activity} /> : null}
          {tableTab === "land" ? <DealTable rows={landDeals} selectedId={selected} onSelect={choose} activity={activity} /> : null}
        </section>
        </PanelBoundary>
      ) : null}
      {ringCursor ? createPortal(
        <div ref={ringNoteRef} className="map-tip-fixed" data-hidden="1">{LAYER_TITLES.rings}</div>,
        document.body,
      ) : null}
    </div>
  );
}
