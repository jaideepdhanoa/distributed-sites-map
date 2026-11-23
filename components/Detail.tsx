import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DealProps, SiteProps, UnscreenedProps } from "@/lib/types";
import { cleanNote, folderHref, formatRecordedDate, leadSourceLine, listingCue, shownBroker, shownFirm, shownPriceSource } from "@/lib/format";
import { NEAR_TIP, contactDate, serviceAreaChip, serviceAreaShort } from "@/lib/cardStatus";
import { RowLinks } from "./RowLinks";
import { safePackageHref } from "@/lib/financials";
import DrawerGrip from "./DrawerGrip";
import { NextStepCard } from "./actions/NextStepCard";
import Timeline from "./timeline/Timeline";
import { ChipFace } from "./ChipFace";
import { stageChipLabel } from "@/lib/chips";
import { droppedDecisionLine } from "@/lib/droppedLine";
import { isQuickLube, nextStepText, plainVerdict, QUICK_LUBE_LABEL, stageDetail, stageTone, statusOf } from "@/lib/labels";
import { acreUnit, capacitySummary, cashTile, checkedPhrase, countYear, factsForDeal, factsForSite, fullMoney, isOpenLandBlank, powerSummary, revenueTile, spareLandSqft, universeTrafficLine } from "@/lib/keyNumbers";
import { derivePowerRating, type PowerRatingInput } from "@/lib/score/power-rating";
import { storedScoreView } from "@/lib/scoreDisplay";
import FinancialsEntry, { PendingFigure, usePnlTiles, type PnlTiles } from "./FinancialsEntry";
import { packageOnFile } from "@/lib/pnl/cue";
import { basisBadge } from "@/lib/pricing";
import { nearestSheetSnap, stepSheet, type SheetSnap } from "@/lib/sheetSnap";
import { cardPhotos, isPanoUrl } from "@/lib/photos";
import { aerialTile, streetViewHref } from "@/lib/aerial";
import KeyStrip, { CapacityFacts, SitePacket } from "./KeyStrip";
import PanelSections from "./PanelSections";
import SitePhotos from "./SitePhotos";
import SpaceSummary from "./spaces/SpaceSummary";
import { NdaChip } from "./NdaChip";
import NdaCardThread from "./NdaCardThread";
import NdaCardLine from "./NdaCardLine";
import { cardNdaLabel } from "@/lib/nda";
import { LocationFix } from "./LocationFix";
import { siteHref } from "@/lib/siteLink";
import { ChipRow, TagChip } from "./TagChip";
import { chipsForDeal } from "@/lib/tags/show";
import { DILIGENCE_FAMILIES, sectionChips } from "@/lib/tags/vocab";
import type { TagView } from "@/lib/tags/map";

function acres(value: number | null | undefined, text?: string) {
  const shown = acreUnit(value, text);
  return shown || "—";
}

function websiteLabel(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//i, "");
  }
}

type SheetControl = {
  expanded: boolean;
  snap?: SheetSnap;
  onToggle: () => void;
  onSnap?: (snap: SheetSnap) => void;
  onStep?: (direction: "more" | "less") => void;
};

function SheetHandle({ sheet }: { sheet?: SheetControl }) {
  const drag = useRef<{ y: number; height: number; moved: boolean } | null>(null);
  const ignoreClick = useRef(false);
  function step(direction: "more" | "less") {
    if (sheet?.onStep) {
      sheet.onStep(direction);
      return;
    }
    sheet?.onSnap?.(stepSheet(sheet.snap ?? "peek", direction));
  }
  return (
    <div className="sheet-handle" data-testid="sheet-handle">
      <button
        type="button"
        className="sheet-grab"
        aria-label="Drag sheet"
        aria-keyshortcuts="ArrowUp ArrowDown"
        onPointerDown={(event) => {
          if (!sheet?.onSnap) return;
          const drawer = event.currentTarget.closest(".drawer") as HTMLElement | null;
          if (!drawer) return;
          ignoreClick.current = false;
          const measured = drawer.getBoundingClientRect().height;
          drag.current = { y: event.clientY, height: measured, moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const info = drag.current;
          if (!info) return;
          const drawer = event.currentTarget.closest(".drawer") as HTMLElement | null;
          if (!drawer) return;
          const delta = info.y - event.clientY;
          if (Math.abs(delta) > 8) info.moved = true;
          if (!info.moved) return;
          const next = Math.min(window.innerHeight * 0.92, Math.max(140, info.height + delta));
          drawer.style.height = `${Math.round(next)}px`;
        }}
        onPointerUp={(event) => {
          const info = drag.current;
          drag.current = null;
          const drawer = event.currentTarget.closest(".drawer") as HTMLElement | null;
          if (!info || !drawer || !sheet?.onSnap) return;
          if (!info.moved) {
            drawer.style.height = "";
            return;
          }
          ignoreClick.current = true;
          const dragged = Number.parseFloat(drawer.style.height);
          const height = Number.isFinite(dragged) ? dragged : info.height || drawer.getBoundingClientRect().height;
          drawer.style.height = "";
          sheet.onSnap(nearestSheetSnap(height, window.innerHeight));
        }}
        onPointerCancel={() => {
          drag.current = null;
          const drawer = document.querySelector(".drawer") as HTMLElement | null;
          if (drawer) drawer.style.height = "";
        }}
        onClick={() => {
          if (ignoreClick.current) {
            ignoreClick.current = false;
            return;
          }
          step("more");
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowRight") {
            event.preventDefault();
            step("more");
          }
          if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
            event.preventDefault();
            step("less");
          }
        }}
      />
    </div>
  );
}

function DecisionChips({
  deal,
  waiting,
  extras = [],
  testId,
}: {
  deal?: DealProps | null;
  waiting?: TagView | null;
  extras?: TagView[];
  testId?: string;
}) {
  if (!deal && !waiting && !extras.length) return null;
  return (
    <div className="card-chips decision-chips" data-testid={testId}>
      {deal ? <StageChip deal={deal} /> : null}
      {waiting ? <TagChip chip={waiting} compact /> : null}
      {extras.map((chip) => <TagChip key={chip.family} chip={chip} compact />)}
    </div>
  );
}

function powerInput(deal?: DealProps | null, site?: SiteProps | null): PowerRatingInput {
  return { ...(deal || site || {}), market: deal?.city || site?.city || "" };
}

function ScoreTile({ deal, site }: { deal?: DealProps | null; site?: SiteProps | null }) {
  const reason = derivePowerRating(powerInput(deal, site)).reason;
  const view = storedScoreView({
    score: deal?.score,
    economics: deal?.economics_points,
    land: deal?.land_points,
    power: deal?.power_points,
    location: deal?.location_points,
    deal: deal?.deal_points,
    savingVsHub: deal?.saving_vs_hub,
    stalls: deal?.bays_that_fit,
    serviceArea: deal?.service_area_class,
    dealRating: deal?.deal_rating,
    powerDetail: reason,
    naEconomics: isQuickLube(deal?.business_type) || isQuickLube(site?.business_type),
  });
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hover || pinned;
  return (
    <section className="score-tile" data-testid="score-tile" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <span>Score</span>
      {view.status === "not_scored" ? <strong data-testid="score-chip">Not scored</strong> : view.status === "provisional" ? (
        <strong data-testid="score-chip" title={`Stored total ${view.total}. Parts sum to ${view.summed}.`}>
          <span className="chip">Provisional</span> {view.summed}
        </strong>
      ) : <strong data-testid="score-chip" title={view.total && view.total !== view.chip ? `Stored total ${view.total}` : undefined}>{view.chip || "—"}</strong>}
      <p className="score-parts" data-testid="score-parts">{view.line}</p>
      <button type="button" className="text-link" data-testid="score-breakdown" aria-expanded={open} onClick={() => setPinned((value) => !value)}>
        {pinned ? "Hide breakdown" : "Breakdown"}
      </button>
      {open ? (
        <div className="score-pop" role="tooltip" data-testid="score-popover">
          {view.parts.map((part) => (
            <p key={part.id}>
              <strong>{part.label} {part.shown}/{part.max}</strong>
              <span>{part.detail}</span>
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function factText(record: object | null | undefined, key: string): string {
  if (!record) return "";
  const value = (record as Record<string, unknown>)[key];
  if (value == null || value === "") return "";
  return String(value);
}

function QuickLubeFacts({ site, deal }: { site?: SiteProps | null; deal?: DealProps | null }) {
  if (!isQuickLube(site?.business_type) && !isQuickLube(deal?.business_type)) return null;
  const record = { ...(deal || {}), ...(site || {}) };
  const text = (key: string) => factText(record, key);
  const brand = text("brand_type");
  const verdict = text("owner_verdict");
  const miles = text("miles_to_depot");
  return (
    <section data-testid="quick-lube-facts">
      <h3>{QUICK_LUBE_LABEL}</h3>
      <div className="kv">
        <span>Brand</span>
        <div>
          {brand ? <ChipFace className="stage-pill tone-pine" label={brand} testId="brand-chip" /> : "—"}
          {text("brand_note") ? ` ${text("brand_note")}` : ""}
        </div>
        <span>Bays</span><div>{text("bay_count") || "—"}</div>
        <span>Lifts</span><div>{text("lift_count") || "—"}</div>
        <span>Lot</span><div>{text("lot_sqft") ? `${text("lot_sqft")} sq ft` : "—"}</div>
        <span>Outside</span><div>{text("outside_sqft") ? `${text("outside_sqft")} sq ft` : "—"}{text("outside_note") ? ` ${text("outside_note")}` : ""}</div>
        <span>Owner</span><div>{text("owner_of_record") || text("owner") || "—"}</div>
        <span>Owns the lot</span>
        <div>{verdict ? <ChipFace className="stage-pill tone-sand" label={verdict} testId="owner-verdict-chip" /> : "—"}</div>
        <span>Listed</span><div>{text("listing_status") || "—"}{text("listing_source") ? ` ${text("listing_source")}` : ""}</div>
        <span>Depot</span><div>{miles ? `${miles} mi` : "—"}</div>
      </div>
      {text("source_tag") ? <p className="note">{text("source_tag")}</p> : null}
    </section>
  );
}

function FigureSkeleton() {
  return (
    <div className="skeleton-block" data-testid="figures-loading" aria-busy="true">
      <span className="skeleton" />
      <span className="skeleton short" />
      <span className="skeleton" />
      <p className="sr">Loading figures</p>
    </div>
  );
}

function HeldNote({ note }: { note: string }) {
  return <small className="figure-hold" aria-hidden={note ? undefined : true}>{note}</small>;
}

function DealHeadline({
  deal,
  censusAcres,
  signedIn = false,
  tiles = null,
  pending = false,
}: {
  deal: DealProps;
  censusAcres?: number | null;
  signedIn?: boolean;
  tiles?: PnlTiles | null;
  pending?: boolean;
}) {
  const cash = cashTile(deal);
  const revenue = revenueTile(deal);
  const shownRevenue = tiles?.revenue ?? { text: revenue.text, title: revenue.title, note: deal.revenue_basis || "" };
  const shownCash = tiles?.cash ?? {
    text: cash.value || "—",
    title: cash.value === "—" ? "Not on file" : (cash.value || "Not on file"),
    note: [cash.note, basisBadge(deal.earnings_basis) || basisBadge(cash.basis)].filter(Boolean).join(" · "),
  };
  const spare = spareLandSqft(deal.open_land_sqft, censusAcres, deal.open_land_basis);
  const bays = deal.bays_that_fit == null ? "—" : String(Math.round(deal.bays_that_fit));
  const land = deal.land_acres != null ? `Land ${deal.land_acres} ac` : "";
  const negative = shownCash.text.startsWith("-");
  const showMoney = signedIn && !cash.hidden;
  const traffic = deal.trade_aadt != null ? Math.round(deal.trade_aadt).toLocaleString() : "—";
  const facts = factsForDeal(deal);
  const power = powerSummary(facts);
  const phrase = (text: string) => (text === "Not in package" ? "phrase" : undefined);
  return (
    <div className="headline" data-testid="card-numbers">
      {showMoney ? (
        <div data-testid="overview-revenue">
          <span>Revenue</span>
          {pending ? <PendingFigure /> : (
            <>
              <strong className={phrase(shownRevenue.text)} title={shownRevenue.title}>{shownRevenue.text}</strong>
              <HeldNote note={shownRevenue.note} />
            </>
          )}
        </div>
      ) : null}
      {showMoney ? (
        <div data-testid="overview-cash">
          <span>Cash flow</span>
          {pending ? <PendingFigure /> : (
            <>
              <strong className={`${negative ? "neg" : ""} ${phrase(shownCash.text) || ""}`.trim() || undefined} title={shownCash.title}>{shownCash.text}</strong>
              <HeldNote note={shownCash.note} />
            </>
          )}
        </div>
      ) : null}
      <div>
        <span>Open land</span>
        <strong title={isOpenLandBlank(spare.value) ? "Not on file" : undefined}>{spare.value}</strong>
        {spare.note ? <small>{spare.note}</small> : null}
      </div>
      <div className="headline-wide">
        <span>Power</span>
        <strong title={capacitySummary(facts) || "Not on file"}>{power || "—"}</strong>
      </div>
      <div>
        <span>Bays that fit</span>
        <strong title={deal.bays_that_fit == null ? "Not on file" : undefined}>{bays}</strong>
        {land ? <small>{land}</small> : null}
      </div>
      <div>
        <span>Traffic</span>
        <strong title={deal.trade_aadt == null ? "Not on file" : undefined}>{traffic}</strong>
        {deal.trade_aadt != null ? <small>vehicles/day</small> : null}
      </div>
    </div>
  );
}

function SiteNumbers({ site, deal, signedIn = false, tiles = null, pending = false }: { site: SiteProps; deal?: DealProps | null; signedIn?: boolean; tiles?: PnlTiles | null; pending?: boolean }) {
  if (deal) return <DealHeadline deal={deal} censusAcres={site.spare_ac_own} signedIn={signedIn} tiles={tiles} pending={pending} />;
  const spare = spareLandSqft(null, site.spare_ac_own);
  const traffic = site.aadt_count != null && site.aadt_count !== "" ? site.aadt_count : "—";
  const year = countYear(site.aadt_year);
  const facts = factsForSite(site, deal);
  const power = powerSummary(facts);
  return (
    <div className="headline" data-testid="card-numbers">
      <div>
        <span>Cash flow</span>
        <strong title="Not on file">—</strong>
      </div>
      <div>
        <span>Open land</span>
        <strong title={isOpenLandBlank(spare.value) ? "Not on file" : undefined}>{spare.value}</strong>
        {spare.note ? <small>{spare.note}</small> : null}
      </div>
      <div className="headline-wide">
        <span>Power</span>
        <strong title={capacitySummary(facts) || "Not on file"}>{power || "—"}</strong>
      </div>
      <div>
        <span>Bays that fit</span>
        <strong title="Not on file">—</strong>
      </div>
      <div>
        <span>Traffic</span>
        <strong>{traffic}</strong>
        {site.aadt_count ? <small>{year ? `vehicles/day · ${year}` : "vehicles/day"}</small> : null}
      </div>
    </div>
  );
}

function visibleChips(deal: DealProps, signedIn: boolean): TagView[] {
  return chipsForDeal({ ...deal }, signedIn);
}

function StageChip({ deal }: { deal: DealProps }) {
  const pending = String(deal.stage_pending || "").trim();
  const decision = droppedDecisionLine(deal);
  return (
    <span className="stage-block">
      <ChipFace
        className={`stage-pill tone-${stageTone(deal)}`}
        testId="stage-chip"
        label={stageChipLabel(deal.stage, deal.stage_group)}
        detail={decision}
        pending={pending}
      />
      {decision ? <span className="stage-decision" data-testid="dropped-decision">{decision}</span> : null}
    </span>
  );
}

function AreaChip({ record }: { record: { service_area_class?: DealProps["service_area_class"]; service_area_distance_mi?: number | null } }) {
  const label = serviceAreaChip(record);
  if (!label) return null;
  const near = record.service_area_class === "near_0_5" || record.service_area_class === "near_5_10";
  return <span className={record.service_area_class === "outside" ? "badge gone" : "badge quiet near-chip"} data-testid={near ? "near-chip" : "service-area-chip"} data-short={near ? serviceAreaShort(record) : undefined} title={near ? NEAR_TIP : undefined}>{label}</span>;
}

function CardLink({ href, label, testId, title }: { href?: string; label: string; testId: string; title?: string }) {
  if (!href) return <span className="card-link missing" data-testid={testId}>{label}</span>;
  return (
    <a className="text-link" data-testid={testId} href={href} target="_blank" rel="noopener noreferrer" title={title}>
      {label} ↗
    </a>
  );
}

function CardLinks({
  listing,
  folder,
  packageHref,
  map,
  street,
  signedIn,
  listingTitle,
  streetLabel = "Street View",
  hideEmptyStreet = false,
}: {
  listing?: string;
  folder?: string;
  packageHref?: string;
  map?: string;
  street?: string;
  signedIn: boolean;
  listingTitle?: string;
  streetLabel?: string;
  hideEmptyStreet?: boolean;
}) {
  return (
    <p className="card-links">
      <RowLinks listing={listing} folder={folder} packageHref={signedIn ? packageHref : ""} listingTitle={listingTitle} showMissing testIds="card" />
      <CardLink href={map} label="Map" testId="map-link" />
      {hideEmptyStreet && !street ? null : <CardLink href={street} label={streetLabel} testId="street-view-link" />}
    </p>
  );
}

function CardFooter({ onOpenReview, onCompare, compared }: { onOpenReview?: () => void; onCompare?: () => void; compared?: boolean }) {
  if (!onOpenReview && !onCompare) return null;
  return (
    <div className="card-footer">
      {onOpenReview ? <button className="text-link" type="button" onClick={onOpenReview}>Open in Review</button> : null}
      {onCompare ? (
        <button className="text-link" type="button" aria-pressed={Boolean(compared)} onClick={onCompare}>{compared ? "In compare" : "Add to compare"}</button>
      ) : null}
    </div>
  );
}

function usePackageHref(id: string, signedIn: boolean) {
  const [href, setHref] = useState("");
  useEffect(() => {
    if (!signedIn || !id) {
      setHref("");
      return undefined;
    }
    let cancel = false;
    fetch(`/api/data/financials/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async (response) => (response.ok ? await response.json() as { packageHref?: string } : null))
      .then((body) => {
        if (!cancel) setHref(safePackageHref(body?.packageHref, true));
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [id, signedIn]);
  return href;
}

function mapHref(lat?: number | null, lng?: number | null) {
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) return "";
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

function streetHref(lat?: number | null, lng?: number | null, streetViewUrl?: string | null) {
  if (streetViewUrl && isPanoUrl(streetViewUrl)) return streetViewUrl;
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) return "";
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
}

function mapsLinks(
  lat?: number | null,
  lng?: number | null,
  listing?: { listing_url?: string | null; listing_removed?: boolean | null } | null,
  required = false,
  folderUrl?: string | null,
  streetViewUrl?: string | null,
) {
  const hasMap = lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng);
  const cue = listing ? listingCue(listing) : null;
  const showListing = Boolean(cue && (required || cue.url));
  const folder = folderHref(folderUrl);
  const point = hasMap ? `${lat},${lng}` : "";
  const generated = hasMap ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${point}` : "";
  const street = streetViewUrl && isPanoUrl(streetViewUrl) ? streetViewUrl : generated;
  if (!hasMap && !showListing && !folder && !street) return null;
  return (
    <p className="map-links">
      {hasMap ? (
        <a href={`https://www.google.com/maps/search/?api=1&query=${point}`} target="_blank" rel="noopener noreferrer">Open in Google Maps</a>
      ) : null}
      {street ? (
        <a href={street} target="_blank" rel="noopener noreferrer" data-testid="street-view-link">Street View</a>
      ) : null}
      {showListing && cue ? (
        cue.url ? (
          <a className="listing-link" data-testid="listing-link" href={cue.url} target="_blank" rel="noopener noreferrer">{cue.label}</a>
        ) : (
          <span className="listing-link muted" data-testid="listing-link">{cue.label}</span>
        )
      ) : null}
      {folder ? (
        <a className="listing-link" data-testid="site-folder-link" href={folder} target="_blank" rel="noopener noreferrer">Open site folder ↗</a>
      ) : null}
    </p>
  );
}

export default function Detail({
  site,
  depotMiles,
  lat,
  lng,
  onOpenDeal,
  onOpenParty,
  linkedDeal,
  onAddCompare,
  compared = false,
  onOpenReview,
  sameOwner,
  onClose,
  sheet,
  extras,
  banner,
  onSwipe,
  figuresReady = true,
  related,
  signedIn = false,
  outsideFilter = false,
  locationFix = null,
  spaceCount = 0,
  spaceSlots = 0,
  spaceSqft = 0,
  onMarkSpace,
  spaceNote,
  onOpenNda,
}: {
  site: SiteProps | null;
  depotMiles?: number | null;
  lat?: number | null;
  lng?: number | null;
  onOpenDeal?: () => void;
  onOpenParty?: (name: string) => void;
  linkedDeal?: DealProps | null;
  onAddCompare?: () => void;
  compared?: boolean;
  onOpenReview?: () => void;
  sameOwner?: { site_id: string; name: string }[];
  onClose?: () => void;
  sheet?: SheetControl;
  extras?: ReactNode;
  banner?: ReactNode;
  onSwipe?: (direction: "next" | "prev") => void;
  figuresReady?: boolean;
  related?: ReactNode;
  signedIn?: boolean;
  outsideFilter?: boolean;
  locationFix?: "edit" | "propose" | null;
  spaceCount?: number;
  spaceSlots?: number;
  spaceSqft?: number;
  onMarkSpace?: () => void;
  spaceNote?: string;
  onOpenNda?: (id: string) => void;
}) {
  const packageHref = usePackageHref(linkedDeal?.deal_id || site?.linked_deal_id || "", signedIn);
  const pnl = usePnlTiles(signedIn && linkedDeal && linkedDeal.kind !== "land" ? linkedDeal.deal_id : "");
  const figuresPending = !pnl.settled;
  if (!site) return null;
  const photos = cardPhotos(site, linkedDeal);
  const storedPano = photos.frontageUrl || (isPanoUrl(site.street_view_url || "") ? site.street_view_url : "");
  const pano = storedPano || streetViewHref(lat, lng);
  const card = pano && pano !== photos.frontageUrl ? { ...photos, frontageUrl: pano } : photos;
  const aerial = aerialTile(lat, lng);
  const price = site.asking_price_display;
  const why = site.summary_why || "Not screened yet.";
  const next = nextStepText(site);
  const unscreened = !site.verdict && (!site.summary_why || site.summary_why === "Not screened yet.") && next === "Not screened yet.";
  const waitingChip = linkedDeal ? visibleChips(linkedDeal, signedIn).find((chip) => chip.family === "waiting_on" && chip.code !== "nothing") || null : null;
  return (
    <aside
      data-record={site.site_id}
      className={`drawer ${sheet?.expanded ? "expanded" : ""} snap-${sheet?.snap || (sheet?.expanded ? "full" : "half")}`}
      onTouchStart={(event) => {
        if ((event.target as HTMLElement).closest(".drawer-grip, .sheet-handle")) return;
        (event.currentTarget as HTMLElement).dataset.x = String(event.changedTouches[0]?.clientX ?? "");
        (event.currentTarget as HTMLElement).dataset.y = String(event.changedTouches[0]?.clientY ?? "");
      }}
      onTouchEnd={(event) => {
        if ((event.target as HTMLElement).closest(".drawer-grip, .sheet-handle")) return;
        const startX = Number((event.currentTarget as HTMLElement).dataset.x || "");
        const startY = Number((event.currentTarget as HTMLElement).dataset.y || "");
        const dx = (event.changedTouches[0]?.clientX ?? startX) - startX;
        const dy = (event.changedTouches[0]?.clientY ?? startY) - startY;
        if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;
        onSwipe?.(dx < 0 ? "next" : "prev");
      }}
    >
      <span className="sr">{site.site_id}</span>
      <DrawerGrip />
      <div className="drawer-head">
        <SheetHandle sheet={sheet} />
        <button
          type="button"
          className="paper-btn"
          data-testid="copy-site-link"
          onClick={() => { void navigator.clipboard.writeText(siteHref(window.location.origin, site.site_id)); }}
        >
          Copy link
        </button>
        <button className="close" type="button" aria-label="Close" onClick={onClose}><span aria-hidden="true">×</span></button>
      </div>
      {banner}
      <div className="drawer-scroll">
      <div className="card-top" data-testid="panel-top">
        <h2>{site.name || site.address || site.site_id}</h2>
        {site.also_known_as ? <p className="note">Also known as: {site.also_known_as}</p> : null}
        <p className="note">{site.address || "—"}</p>
        {locationFix ? <LocationFix id={site.site_id} mode={locationFix} address={site.address || ""} lat={lat} lng={lng} /> : null}
        {outsideFilter ? <p className="note" data-testid="outside-filter">Outside the current filter</p> : null}
        {site.land_only ? <p className="note">Land site</p> : null}
        {site.origin === "off-market" ? <p className="note">Other off-market</p> : null}
      </div>
      <SitePhotos card={card} aerialUrl={aerial?.url || ""} siteKey={site.site_id} emptyNote={aerial && !pano ? "Aerial only — no site photos yet" : ""} />
      <section className="decision-block" data-testid="decision-block">
        <DecisionChips deal={linkedDeal} waiting={waitingChip} />
        <NextStepCard
          kind="site"
          id={site.site_id}
          stageGroup={linkedDeal?.stage_group}
          stage={linkedDeal?.stage || site.pipeline_stage}
          signedIn={signedIn}
          workbookId={linkedDeal?.deal_id || site.linked_deal_id || ""}
          suggestedDrop={linkedDeal?.suggested_drop}
          blocker={linkedDeal}
          waitingShown={Boolean(waitingChip)}
        />
      </section>
      <div className="card-chips">
        <span className={`badge ${site.verdict === "PASS" ? "checked" : site.verdict === "FAIL" || site.verdict === "NOT_A_WASH" ? "gone" : "pending"}`} title={statusOf(site).note}>{statusOf(site).label}</span>
        <AreaChip record={linkedDeal?.service_area_class ? linkedDeal : site} />
        <NdaChip deal={linkedDeal || undefined} signedIn={signedIn} showMissing onOpen={onOpenNda} />
        {onOpenNda && linkedDeal?.nda_id && cardNdaLabel(linkedDeal, Boolean(signedIn)) ? (
          <>
            <NdaCardLine ndaId={linkedDeal.nda_id} mirror={linkedDeal} />
            <NdaCardThread ndaId={linkedDeal.nda_id} onOpen={onOpenNda} />
          </>
        ) : null}
      </div>
      {signedIn && figuresReady && price ? <p className="note">Asking {price}</p> : figuresReady ? null : <p className="note">Loading figures</p>}
      {site.linked_deal_id ? (
        <p>
          <button className="text-link" type="button" data-testid="pipeline-deal-link" title={site.linked_deal_id} onClick={onOpenDeal}>
            Open the pipeline deal
          </button>
        </p>
      ) : null}
      <CardLinks
        listing={linkedDeal?.listing_url || site.listing_url || ""}
        folder={folderHref(site.folder_url || linkedDeal?.folder_url)}
        packageHref={packageHref}
        map={mapHref(lat, lng)}
        street={pano ? "" : streetViewHref(lat, lng)}
        streetLabel="Open Street View"
        hideEmptyStreet
        signedIn={signedIn}
        listingTitle={linkedDeal?.listing_removed ? "May be removed" : undefined}
      />
      <ScoreTile deal={linkedDeal} site={site} />
      {figuresReady ? <SiteNumbers site={site} deal={linkedDeal} signedIn={signedIn} tiles={pnl.tiles} pending={figuresPending} /> : <FigureSkeleton />}
      {signedIn && linkedDeal && linkedDeal.kind !== "land" ? (
        <FinancialsEntry dealId={linkedDeal.deal_id} packageOnFile={packageOnFile(linkedDeal.package_status, linkedDeal.package_line)} loaded={pnl} />
      ) : null}
      {signedIn ? <SpaceSummary count={spaceCount} slots={spaceSlots} sqft={spaceSqft} note={spaceNote} onMark={onMarkSpace} /> : null}
      {related}
      <PanelSections
        overview={
          <>
            <details className="disclosure">
              <summary className="disclosure">Record</summary>
              <p>{site.site_id}{site.linked_deal_id ? ` · ${site.linked_deal_id}` : ""}</p>
            </details>
            {unscreened ? (
              <p>Not screened yet.</p>
            ) : (
              <>
                <h3>Summary</h3>
                <p><strong>{plainVerdict(site.verdict)}.</strong> {why}</p>
                <p>Next step: {next}</p>
              </>
            )}
            <h3>Lead source</h3>
            <p>{leadSourceLine(site, linkedDeal)}</p>
            {linkedDeal && (shownBroker(linkedDeal) || shownFirm(linkedDeal) || linkedDeal.last_broker_contact) ? (
              <>
                <h3>Broker</h3>
                <div className="kv">
                  <span>Broker</span>
                  <div>
                    {shownBroker(linkedDeal) ? <button className="text-link" type="button" data-testid="broker-link" onClick={() => onOpenParty?.(shownBroker(linkedDeal))}>{shownBroker(linkedDeal)}</button> : <span title="Not on file">—</span>}
                    {linkedDeal.last_broker_contact ? ` · Last contact ${contactDate(linkedDeal.last_broker_contact)}` : ""}
                  </div>
                  <span>Firm</span>
                  <div>{shownFirm(linkedDeal) ? <button className="text-link" type="button" data-testid="firm-link" onClick={() => onOpenParty?.(shownFirm(linkedDeal))}>{shownFirm(linkedDeal)}</button> : <span title="Not on file">—</span>}</div>
                </div>
              </>
            ) : null}
            {site.place_note ? (
              <>
                <h3>Contact</h3>
                <div className="kv">
                  <span>Note</span><div>{site.place_note}{site.place_note_source ? ` · ${site.place_note_source}` : ""}</div>
                </div>
              </>
            ) : site.phone || site.website ? (
              <>
                <h3>Contact</h3>
                <div className="kv">
                  {site.phone ? <><span>Phone</span><div>{site.phone}{site.phone_source ? ` · ${site.phone_source}` : ""}</div></> : null}
                  {site.website ? (
                    <>
                      <span>Website</span>
                      <div>
                        <a href={site.website} target="_blank" rel="noopener noreferrer">{websiteLabel(site.website)}</a>
                        {site.website_source ? ` · ${site.website_source}` : ""}
                      </div>
                    </>
                  ) : null}
                </div>
              </>
            ) : null}
            <QuickLubeFacts site={site} deal={linkedDeal} />
            <h3>Owner</h3>
            <p>{site.owner || "—"}</p>
            {site.owner_mail ? <p className="note">Mailing address: {site.owner_mail}</p> : null}
            {sameOwner && sameOwner.length ? (
              <>
                <h3>Other sites with this owner</h3>
                <ul>{sameOwner.map((item) => <li key={item.site_id}>{item.name || item.site_id}</li>)}</ul>
              </>
            ) : null}
            {site.assessor_source ? <p className="note">{site.assessor_source}</p> : null}
            <h3>Verdict</h3>
            <div className="kv">
              <span>Verdict</span><div>{plainVerdict(site.verdict)}</div>
              <span>Operating</span><div>{site.operating || "—"}</div>
              <span>Tenure</span><div>{site.tenure || "—"}</div>
            </div>
            {site.research_sources ? (
              <>
                <h3>Research sources</h3>
                <p>{site.research_sources}</p>
                {site.research_note ? <p>{site.research_note}</p> : null}
              </>
            ) : null}
            {cleanNote(site.evidence) ? (
              <details className="disclosure">
                <summary className="disclosure">Research notes</summary>
                <p>{cleanNote(site.evidence)}</p>
              </details>
            ) : null}
            <h3>Status</h3>
            <div className="kv">
              <span>Listed</span><div>{site.listed ? "Yes" : "No"}</div>
              <span>Contacted</span><div>{site.contacted ? "Yes" : "No"}</div>
              <span>Depot</span><div title={depotMiles == null && site.miles_to_depot == null ? "Not on file" : undefined}>{depotMiles == null ? (site.miles_to_depot == null ? "—" : `${site.miles_to_depot.toFixed(1)} mi`) : `${depotMiles.toFixed(1)} mi`}</div>
              <span>County parcel</span><div>{site.county_url ? <a href={site.county_url} target="_blank" rel="noopener noreferrer">Open county record</a> : "—"}</div>
              <span>Parcel</span><div>{site.parcel_match === "none" ? "No parcel found" : site.parcel_match === "pin location" ? "Matched by pin location" : site.parcel_match === "parcel number" ? "Matched by parcel number" : "—"}</div>
              {site.listed ? (
                <>
                  <span>Listing</span>
                  <div>
                    {site.listing_url ? (
                      <a href={site.listing_url} target="_blank" rel="noopener noreferrer">View listing</a>
                    ) : (
                      "No listing link on file"
                    )}
                  </div>
                </>
              ) : null}
            </div>
            {site.linked_deal_id ? (
              <>
                <h3>Pipeline deal</h3>
                <p>
                  <button className="text-link" type="button" onClick={onOpenDeal}>
                    {site.linked_deal_name || site.linked_deal_id}
                  </button>
                  {site.linked_deal_stage ? ` · ${site.linked_deal_stage}` : ""}
                </p>
              </>
            ) : null}
          </>
        }
        numbers={figuresReady ? (
          <>
            <SitePacket site={site} deal={linkedDeal} hasPin={lat != null && lng != null} signedIn={signedIn} tiles={pnl.tiles} pending={figuresPending} />
            <div className="kv">
              <span>Asking price</span>
              <div>
                {price || "—"}
                {site.asking_price_source ? ` · ${site.asking_price_source}` : ""}
              </div>
              <span>Lot</span><div>{site.parcel_acres != null ? `${site.parcel_acres} ac` : acres(site.lot_ac)}{site.parcel_acres != null || site.lot_ac_source ? ` · ${site.lot_ac_source || "County assessor"}` : ""}</div>
              <span>Open land</span><div title={isOpenLandBlank(spareLandSqft(linkedDeal?.open_land_sqft, site.spare_ac_own, linkedDeal?.open_land_basis).value) ? "Not on file" : undefined}>{(() => { const spare = spareLandSqft(linkedDeal?.open_land_sqft, site.spare_ac_own, linkedDeal?.open_land_basis); return spare.note ? `${spare.value} · ${spare.note}` : spare.value; })()}</div>
              <span>Power</span>
              <div><CapacityFacts facts={factsForSite(site, linkedDeal)} /></div>
              <span>Adjoining</span><div>{acres(site.spare_ac_adjoining, site.spare_ac_adjoining_text)}</div>
              <span>Zoning</span><div>{site.zoning || "—"}{site.zoning_source ? ` · ${site.zoning_source}` : ""}</div>
              <span>Traffic</span><div title={universeTrafficLine(site) ? undefined : "Not on file"}>{universeTrafficLine(site) || "—"}</div>
              <span>Flood</span><div>{site.flood_zone || "—"}</div>
              <span>Year built</span><div>{site.year_built || "—"}</div>
              <span>County assessed value</span><div>{site.assessed_value_display || "—"}</div>
              <span>County full cash value</span><div>{site.full_cash_value_display || "—"}</div>
              <span>Last recorded sale</span><div>{[formatRecordedDate(site.last_sale_date), site.last_sale_price_display].filter(Boolean).join(" · ") || "—"}</div>
            </div>
            {site.listed && site.in_area && site.apn ? (
              <>
                <h3>County record</h3>
                <span className="badge checked">County record pulled</span>
                <div className="kv">
                  <span>Acres</span><div>{site.parcel_acres != null ? `${site.parcel_acres} ac` : site.lot_ac != null ? `${site.lot_ac} ac` : "—"}</div>
                  <span>Owner</span><div>{site.owner || "—"}</div>
                  <span>Land use</span><div>{site.land_use || site.zoning || "—"}</div>
                  <span>County link</span><div>{site.county_url ? <a href={site.county_url} target="_blank" rel="noopener noreferrer">Open county record</a> : "—"}</div>
                </div>
              </>
            ) : null}
          </>
        ) : <p className="note">Loading figures</p>}
        activity={<Timeline recordId={site.site_id} relatedId={site.linked_deal_id || ""} />}
        discussion={extras}
      />
      <CardFooter onOpenReview={onOpenReview} onCompare={onAddCompare} compared={compared} />
      </div>
    </aside>
  );
}

export function DealDetail({
  deal,
  peers,
  universeSite,
  universeName,
  depotMiles,
  lat,
  lng,
  onOpenSite,
  onOpenParty,
  onClose,
  onCompare,
  onOpenReview,
  compared,
  sheet,
  extras,
  banner,
  onSwipe,
  signedIn = false,
  figuresReady = true,
  related,
  outsideFilter = false,
  locationFix = null,
  spaceCount = 0,
  spaceSlots = 0,
  spaceSqft = 0,
  onMarkSpace,
  spaceNote,
  onOpenNda,
}: {
  deal: DealProps;
  peers?: DealProps[];
  universeSite?: SiteProps | null;
  universeName?: string;
  depotMiles?: number | null;
  lat?: number | null;
  lng?: number | null;
  onOpenSite?: () => void;
  onOpenParty?: (name: string) => void;
  onClose?: () => void;
  onCompare?: (on: boolean) => void;
  onOpenReview?: () => void;
  compared?: boolean;
  sheet?: SheetControl;
  extras?: ReactNode;
  banner?: ReactNode;
  onSwipe?: (direction: "next" | "prev") => void;
  signedIn?: boolean;
  figuresReady?: boolean;
  related?: ReactNode;
  outsideFilter?: boolean;
  locationFix?: "edit" | "propose" | null;
  spaceCount?: number;
  spaceSlots?: number;
  spaceSqft?: number;
  onMarkSpace?: () => void;
  spaceNote?: string;
  onOpenNda?: (id: string) => void;
}) {
  const packageHref = usePackageHref(deal.deal_id, signedIn);
  const pnl = usePnlTiles(signedIn && deal.kind !== "land" ? deal.deal_id : "");
  const figuresPending = !pnl.settled;
  const hasPin = lat != null && lng != null;
  const photos = cardPhotos(deal, universeSite);
  const cash = cashTile(deal);
  const revenue = revenueTile(deal);
  const cue = listingCue(deal);
  const chips = visibleChips(deal, signedIn);
  const waiting = chips.find((chip) => chip.family === "waiting_on" && chip.code !== "nothing") || null;
  const gap = chips.find((chip) => chip.family === "biggest_gap");
  const recordChips = sectionChips(chips, ["drop_reason", "advance_reason", "package", "listing", "lead_source", "business_check", "photos", "nda"]);
  const diligence = sectionChips(chips, DILIGENCE_FAMILIES);
  return (
    <aside
      data-record={deal.deal_id}
      className={`drawer ${sheet?.expanded ? "expanded" : ""} snap-${sheet?.snap || (sheet?.expanded ? "full" : "half")}`}
      onTouchStart={(event) => {
        if ((event.target as HTMLElement).closest(".drawer-grip, .sheet-handle")) return;
        (event.currentTarget as HTMLElement).dataset.x = String(event.changedTouches[0]?.clientX ?? "");
        (event.currentTarget as HTMLElement).dataset.y = String(event.changedTouches[0]?.clientY ?? "");
      }}
      onTouchEnd={(event) => {
        if ((event.target as HTMLElement).closest(".drawer-grip, .sheet-handle")) return;
        const startX = Number((event.currentTarget as HTMLElement).dataset.x || "");
        const startY = Number((event.currentTarget as HTMLElement).dataset.y || "");
        const dx = (event.changedTouches[0]?.clientX ?? startX) - startX;
        const dy = (event.changedTouches[0]?.clientY ?? startY) - startY;
        if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;
        onSwipe?.(dx < 0 ? "next" : "prev");
      }}
    >
      <span className="sr">{deal.deal_id}</span>
      <DrawerGrip />
      <div className="drawer-head">
        <SheetHandle sheet={sheet} />
        <button className="close" type="button" aria-label="Close" onClick={onClose}><span aria-hidden="true">×</span></button>
      </div>
      {banner}
      <div className="drawer-scroll">
      <div className="card-top" data-testid="panel-top">
        <h2>{deal.name || deal.address}</h2>
        <p className="note">{deal.address}</p>
        {locationFix ? <LocationFix id={deal.deal_id} mode={locationFix} address={deal.address || ""} lat={lat} lng={lng} /> : null}
        {outsideFilter ? <p className="note" data-testid="outside-filter">Outside the current filter</p> : null}
      </div>
      <SitePhotos card={photos} />
      <section className="decision-block" data-testid="decision-block">
        <DecisionChips deal={deal} waiting={waiting} extras={gap ? [gap] : []} testId="header-chips" />
        <NdaChip deal={deal} signedIn={signedIn} showMissing onOpen={onOpenNda} />
        {onOpenNda && deal.nda_id && cardNdaLabel(deal, Boolean(signedIn)) ? (
          <>
            <NdaCardLine ndaId={deal.nda_id} mirror={deal} />
            <NdaCardThread ndaId={deal.nda_id} onOpen={onOpenNda} />
          </>
        ) : null}
        <NextStepCard
          kind="deal"
          id={deal.deal_id}
          stageGroup={deal.stage_group}
          stage={deal.stage}
          signedIn={signedIn}
          suggestedDrop={deal.suggested_drop}
          blocker={deal}
          chips={chips}
          waitingShown={Boolean(waiting)}
        />
      </section>
      <ChipRow chips={diligence} testId="diligence-home" titled />
      {[deal.checked_live ? checkedPhrase(deal.checked_live) : "", signedIn ? `Asking ${deal.asking_price_display || "—"}` : ""].filter(Boolean).length ? <p className="note">{[deal.checked_live ? checkedPhrase(deal.checked_live) : "", signedIn ? `Asking ${deal.asking_price_display || "—"}` : ""].filter(Boolean).join(" · ")}</p> : null}
      <CardLinks
        listing={cue.url}
        folder={folderHref(deal.folder_url)}
        packageHref={packageHref}
        map={mapHref(lat, lng)}
        street={streetHref(lat, lng, photos.frontageUrl || deal.street_view_url)}
        signedIn={signedIn}
        listingTitle={deal.listing_removed ? "May be removed" : undefined}
      />
      <ScoreTile deal={deal} site={universeSite} />
      {figuresReady ? <DealHeadline deal={deal} censusAcres={universeSite?.spare_ac_own} signedIn={signedIn} tiles={pnl.tiles} pending={figuresPending} /> : <FigureSkeleton />}
      {signedIn && deal.kind !== "land" ? (
        <FinancialsEntry dealId={deal.deal_id} packageOnFile={packageOnFile(deal.package_status, deal.package_line)} loaded={pnl} />
      ) : null}
      {signedIn ? <SpaceSummary count={spaceCount} slots={spaceSlots} sqft={spaceSqft} note={spaceNote} onMark={onMarkSpace} /> : null}
      {related}
      <PanelSections
        overview={
          <>
            <details className="disclosure">
              <summary className="disclosure">Record</summary>
              <p>{deal.deal_id}{deal.universe_id ? ` · ${deal.universe_id}` : ""}</p>
            </details>
            <AreaChip record={deal} />
            <ChipRow chips={recordChips} testId="section-chips" />
            <QuickLubeFacts site={universeSite} deal={deal} />
            <h3>Broker</h3>
            <div className="kv">
              <span>Broker</span>
              <div>
                {shownBroker(deal) ? <button className="text-link" type="button" data-testid="broker-link" onClick={() => onOpenParty?.(shownBroker(deal))}>{shownBroker(deal)}</button> : <span title="Not on file">—</span>}
                {deal.last_broker_contact ? ` · Last contact ${contactDate(deal.last_broker_contact)}` : ""}
              </div>
              <span>Firm</span>
              <div>{shownFirm(deal) ? <button className="text-link" type="button" data-testid="firm-link" onClick={() => onOpenParty?.(shownFirm(deal))}>{shownFirm(deal)}</button> : <span title="Not on file">—</span>}</div>
              <span>Lead source</span><div>{leadSourceLine({ origin: deal.source_kind === "off-market" ? "off-market" : "universe", research_sources: "", verification: "" } as SiteProps, deal)}</div>
              <span>Stage</span><div>{stageDetail(deal.stage, deal.stage_group)}</div>
              <span>Parcel</span><div>{deal.parcel_match === "none" ? "No parcel found" : deal.parcel_match === "pin location" ? "Matched by pin location" : deal.parcel_match === "parcel number" ? "Matched by parcel number" : "Not matched"}</div>
              <span>Depot</span><div title={depotMiles == null && hasPin ? "Not on file" : undefined}>{depotMiles == null ? (hasPin ? "—" : "No pin yet") : `${depotMiles.toFixed(1)} mi`}</div>
              <span>Listing</span>
              <div>
                {deal.listing_url ? (
                  <a href={deal.listing_url} target="_blank" rel="noopener noreferrer">{listingCue(deal).label}</a>
                ) : (
                  cue.label
                )}
              </div>
            </div>
            {deal.universe_id ? (
              <div data-testid="universe-preview">
                <h3>Universe site</h3>
                <p>
                  <button className="text-link" type="button" onClick={onOpenSite}>{universeName || deal.universe_id}</button>
                  {` · ${deal.universe_id}`}
                </p>
                <p>{universeTrafficLine(universeSite) || "—"}</p>
              </div>
            ) : hasPin ? (
              <p className="note" data-testid="universe-gap">This listing has a location and is not linked to a universe site yet.</p>
            ) : null}
          </>
        }
        numbers={
          <>
            {figuresReady ? <KeyStrip deal={deal} hasPin={hasPin} peers={peers || []} universeSite={universeSite} signedIn={signedIn} tiles={pnl.tiles} pending={figuresPending} /> : null}
            <ChipRow chips={diligence} testId="diligence-strip" titled />
            <div className="kv">
              <span>Asking price</span>
              <div>
                {signedIn ? (deal.asking_price_display || "—") : "—"}
                {signedIn && shownPriceSource(deal) ? ` · ${shownPriceSource(deal)}` : ""}
              </div>
              <span>Per acre</span>
              <div>{signedIn && deal.price_per_acre != null ? fullMoney(deal.price_per_acre) : "—"}</div>
              <span>Open land</span>
              <div title={isOpenLandBlank(spareLandSqft(deal.open_land_sqft, universeSite?.spare_ac_own, deal.open_land_basis).value) ? "Not on file" : undefined}>{(() => { const spare = spareLandSqft(deal.open_land_sqft, universeSite?.spare_ac_own, deal.open_land_basis); return spare.note ? `${spare.value} · ${spare.note}` : spare.value; })()}</div>
              <span>Power</span>
              <div><CapacityFacts facts={factsForDeal(deal)} /></div>
              {signedIn && !cash.hidden ? <span>Revenue</span> : null}
              {signedIn && !cash.hidden ? (figuresPending ? <div data-testid="summary-revenue" aria-busy="true"><span className="skeleton figure-line" data-testid="figure-loading" /><span className="sr">Loading figures</span></div> : <div data-testid="summary-revenue" title={(pnl.tiles?.revenue || revenue).title}>{pnl.tiles ? [pnl.tiles.revenue.text, pnl.tiles.revenue.note].filter(Boolean).join(" · ") : [revenue.text, deal.revenue_basis].filter(Boolean).join(" · ")}</div>) : null}
              {signedIn && !cash.hidden ? <span>Cash flow</span> : null}
              {signedIn && !cash.hidden ? (figuresPending ? <div data-testid="summary-cash" aria-busy="true"><span className="skeleton figure-line" data-testid="figure-loading" /><span className="sr">Loading figures</span></div> : <div data-testid="summary-cash" title={pnl.tiles?.cash.title || (cash.value === "—" ? "Not on file" : cash.value)}>{pnl.tiles ? [pnl.tiles.cash.text, pnl.tiles.cash.note].filter(Boolean).join(" · ") : [cash.value || "—", cash.note, basisBadge(deal.earnings_basis) || basisBadge(cash.basis)].filter(Boolean).join(" · ")}</div>) : null}
            </div>
          </>
        }
        activity={<Timeline recordId={deal.deal_id} relatedId={deal.universe_id || ""} />}
        discussion={extras}
      />
      <CardFooter onOpenReview={onOpenReview} onCompare={onCompare ? () => onCompare(!compared) : undefined} compared={compared} />
      </div>
    </aside>
  );
}

export function UnscreenedDetail({
  row,
  lat,
  lng,
  onClose,
  sheet,
}: {
  row: UnscreenedProps;
  lat?: number | null;
  lng?: number | null;
  onClose?: () => void;
  sheet?: SheetControl;
}) {
  return (
    <aside className={`drawer ${sheet?.expanded ? "expanded" : ""} snap-${sheet?.snap || (sheet?.expanded ? "full" : "half")}`}>
      <div className="drawer-head">
        <SheetHandle sheet={sheet} />
        <button className="close" type="button" aria-label="Close" onClick={onClose}><span aria-hidden="true">×</span></button>
      </div>
      <div className="drawer-scroll">
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <span className="badge quiet">Listed, not yet screened</span>
        <span className="badge quiet">{row.kind}</span>
        {row.approximate ? <span className="badge quiet">Approximate location</span> : null}
        {!row.pinned ? <span className="badge quiet">Address withheld</span> : null}
      </div>
      <h2>{row.name}</h2>
      <p className="note">{row.address}</p>
      <p className="note">{row.listing_id}</p>
      {mapsLinks(lat, lng)}
      <h3>Listing</h3>
      <div className="kv">
        <span>Type</span><div>{row.kind}</div>
        <span>Asking price</span>
        <div>
          {row.asking_price_display || "Not published"}
          {row.asking_price_source ? ` · ${row.asking_price_source}` : ""}
        </div>
        <span>Acres</span><div>{row.acres_text || (row.acres != null ? `${row.acres} ac` : "—")}</div>
        <span>Listing</span>
        <div>
          {row.listing_url ? (
            <a href={row.listing_url} target="_blank" rel="noopener noreferrer">View listing</a>
          ) : (
            "No listing link on file"
          )}
        </div>
      </div>
      </div>
    </aside>
  );
}
