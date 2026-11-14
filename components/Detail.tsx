import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DealProps, SiteProps, UnscreenedProps } from "@/lib/types";
import { cleanNote, formatRecordedDate, leadSourceLine, listingCue, shownBroker, shownFirm, shownPriceSource } from "@/lib/format";
import { contactDate, serviceAreaChip } from "@/lib/cardStatus";
import { safePackageHref } from "@/lib/financials";
import DrawerGrip from "./DrawerGrip";
import { NextStepCard } from "./actions/NextStepCard";
import Timeline from "./timeline/Timeline";
import { nextStepText, plainVerdict, stageDetail, stageTone, statusOf } from "@/lib/labels";
import { acreUnit, cashTile, checkedPhrase, factsForDeal, factsForSite, fullMoney, spareLandSqft, universeTrafficLine } from "@/lib/keyNumbers";
import { nearestSheetSnap, stepSheet, type SheetSnap } from "@/lib/sheetSnap";
import { cardPhotos, isPanoUrl } from "@/lib/photos";
import KeyStrip, { CapacityFacts, SitePacket } from "./KeyStrip";
import PanelSections from "./PanelSections";
import SitePhotos from "./SitePhotos";
import { NdaChip } from "./NdaChip";

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

const FOLDER_URL = /^https:\/\/drive\.google\.com\/drive\/folders\/[A-Za-z0-9_-]+$/;

type SheetControl = {
  expanded: boolean;
  snap?: SheetSnap;
  onToggle: () => void;
  onSnap?: (snap: SheetSnap) => void;
};

function SheetHandle({ sheet }: { sheet?: SheetControl }) {
  const drag = useRef<{ y: number; height: number } | null>(null);
  return (
    <div className="sheet-handle" data-testid="sheet-handle">
      <button
        type="button"
        className="sheet-grab"
        aria-label="Drag sheet"
        onPointerDown={(event) => {
          if (!sheet?.onSnap) return;
          const drawer = event.currentTarget.closest(".drawer") as HTMLElement | null;
          if (!drawer) return;
          drag.current = { y: event.clientY, height: drawer.getBoundingClientRect().height };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const info = drag.current;
          if (!info) return;
          const drawer = event.currentTarget.closest(".drawer") as HTMLElement | null;
          if (!drawer) return;
          const next = Math.min(window.innerHeight * 0.92, Math.max(140, info.height + (info.y - event.clientY)));
          drawer.style.height = `${Math.round(next)}px`;
        }}
        onPointerUp={(event) => {
          const info = drag.current;
          drag.current = null;
          const drawer = event.currentTarget.closest(".drawer") as HTMLElement | null;
          if (!info || !drawer || !sheet?.onSnap) return;
          if (Math.abs(info.y - event.clientY) < 10) {
            drawer.style.height = "";
            sheet.onSnap(stepSheet(sheet.snap ?? "peek", "more"));
            return;
          }
          sheet.onSnap(nearestSheetSnap(drawer.getBoundingClientRect().height, window.innerHeight));
          window.requestAnimationFrame(() => {
            drawer.style.height = "";
          });
        }}
        onPointerCancel={() => {
          drag.current = null;
          const drawer = document.querySelector(".drawer") as HTMLElement | null;
          if (drawer) drawer.style.height = "";
        }}
      />
    </div>
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

function DealHeadline({ deal, censusAcres }: { deal: DealProps; censusAcres?: number | null }) {
  const cash = cashTile(deal);
  const spare = spareLandSqft(deal.open_land_sqft, censusAcres);
  const bays = deal.bays_that_fit == null ? "Not on file" : String(Math.round(deal.bays_that_fit));
  const land = deal.land_acres != null ? `Land ${deal.land_acres} ac` : "";
  const cashLabel = deal.stated_revenue_display && !deal.stated_cash_flow_display ? "Revenue" : "Cash flow";
  const negative = deal.stated_cash_flow != null && deal.stated_cash_flow < 0;
  const traffic = deal.trade_aadt != null ? Math.round(deal.trade_aadt).toLocaleString() : "Not on file";
  return (
    <div className="headline" data-testid="card-numbers">
      {cash.hidden ? null : (
        <div>
          <span>{cashLabel}</span>
          <strong className={negative ? "neg" : ""}>{cash.value}</strong>
          {[cash.note, cash.basis].filter(Boolean).length ? <small>{[cash.note, cash.basis].filter(Boolean).join(" · ")}</small> : null}
        </div>
      )}
      <div>
        <span>Spare land</span>
        <strong>{spare.value}</strong>
        {spare.note ? <small>{spare.note}</small> : null}
      </div>
      <div>
        <span>Bays that fit</span>
        <strong>{bays}</strong>
        {land ? <small>{land}</small> : null}
      </div>
      <div>
        <span>Traffic</span>
        <strong>{traffic}</strong>
        {deal.trade_aadt != null ? <small>vehicles/day</small> : null}
      </div>
    </div>
  );
}

function SiteNumbers({ site, deal }: { site: SiteProps; deal?: DealProps | null }) {
  if (deal) return <DealHeadline deal={deal} censusAcres={site.spare_ac_own} />;
  const spare = spareLandSqft(null, site.spare_ac_own);
  const traffic = site.aadt_count ? site.aadt_count : "Not on file";
  return (
    <div className="headline" data-testid="card-numbers">
      <div>
        <span>Cash flow</span>
        <strong>Not on file</strong>
      </div>
      <div>
        <span>Spare land</span>
        <strong>{spare.value}</strong>
        {spare.note ? <small>{spare.note}</small> : null}
      </div>
      <div>
        <span>Bays that fit</span>
        <strong>Not on file</strong>
      </div>
      <div>
        <span>Traffic</span>
        <strong>{traffic}</strong>
        {site.aadt_count ? <small>vehicles/day</small> : null}
      </div>
    </div>
  );
}

function StageChip({ deal }: { deal: DealProps }) {
  const pending = String(deal.stage_pending || "").trim();
  return (
    <span className={`stage-pill tone-${stageTone(deal)}`}>
      {stageDetail(deal.stage, deal.stage_group)}
      {pending ? (
        <span className="stage-wait" data-testid="stage-pending" title={pending}>
          waiting
          <span className="sr">{pending}</span>
        </span>
      ) : null}
    </span>
  );
}

function AreaChip({ record }: { record: { service_area_class?: DealProps["service_area_class"]; service_area_distance_mi?: number | null } }) {
  const label = serviceAreaChip(record);
  if (!label) return null;
  return <span className={record.service_area_class === "outside" ? "badge gone" : "badge quiet"} data-testid="service-area-chip">{label}</span>;
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
}: {
  listing?: string;
  folder?: string;
  packageHref?: string;
  map?: string;
  street?: string;
  signedIn: boolean;
  listingTitle?: string;
}) {
  return (
    <p className="card-links">
      <CardLink href={listing} label="Listing" testId="listing-link" title={listingTitle} />
      <CardLink href={folder} label="Folder" testId="site-folder-link" />
      {signedIn ? <CardLink href={packageHref} label="Package" testId="package-link" /> : null}
      <CardLink href={map} label="Map" testId="map-link" />
      <CardLink href={street} label="Street View" testId="street-view-link" />
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
    fetch(`/api/data/financials/${encodeURIComponent(id)}`)
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

function folderHref(value?: string | null) {
  return value && FOLDER_URL.test(value) ? value : "";
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
  const folder = folderUrl && FOLDER_URL.test(folderUrl) ? folderUrl : "";
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
}) {
  const packageHref = usePackageHref(linkedDeal?.deal_id || site?.linked_deal_id || "", signedIn);
  if (!site) return null;
  const photos = cardPhotos(site, linkedDeal);
  const street = photos.frontageUrl || site.street_view_url;
  const price = site.asking_price_display;
  const why = site.summary_why || "Not screened yet.";
  const next = nextStepText(site);
  const unscreened = !site.verdict && (!site.summary_why || site.summary_why === "Not screened yet.") && next === "Not screened yet.";
  return (
    <aside
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
      <DrawerGrip />
      <div className="drawer-head">
        <SheetHandle sheet={sheet} />
        <button className="close" type="button" aria-label="Close" onClick={onClose}><span aria-hidden="true">×</span></button>
      </div>
      {banner}
      <div className="drawer-scroll">
      <SitePhotos
        card={photos}
        between={(
          <>
      <div className="card-top">
        <h2>{site.name || site.address || site.site_id}</h2>
        <div className="card-chips">
          {linkedDeal ? <StageChip deal={linkedDeal} /> : null}
          <span className={`badge ${site.verdict === "PASS" ? "checked" : site.verdict === "FAIL" || site.verdict === "NOT_A_WASH" ? "gone" : "pending"}`} title={statusOf(site).note}>{statusOf(site).label}</span>
          <AreaChip record={linkedDeal?.service_area_class ? linkedDeal : site} />
          {linkedDeal ? <NdaChip deal={linkedDeal} signedIn={signedIn} /> : null}
        </div>
        {site.also_known_as ? <p className="note">Also known as: {site.also_known_as}</p> : null}
        <p className="note">{site.address || "—"}</p>
        <p className="note">{site.site_id}{figuresReady && price ? ` · Asking ${price}` : ""}{figuresReady ? "" : " · Loading figures"}</p>
        {site.land_only ? <p className="note">Land site</p> : null}
        {site.origin === "off-market" ? <p className="note">Other off-market</p> : null}
        {site.linked_deal_id ? (
          <p>
            <button className="text-link" type="button" data-testid="pipeline-deal-link" onClick={onOpenDeal}>
              Pipeline deal {site.linked_deal_id}
            </button>
          </p>
        ) : null}
        <CardLinks
          listing={linkedDeal?.listing_url || site.listing_url || ""}
          folder={folderHref(site.folder_url || linkedDeal?.folder_url)}
          packageHref={packageHref}
          map={mapHref(lat, lng)}
          street={streetHref(lat, lng, photos.frontageUrl || site.street_view_url)}
          signedIn={signedIn}
          listingTitle={linkedDeal?.listing_removed ? "May be removed" : undefined}
        />
      </div>
      <NextStepCard
        kind="site"
        id={site.site_id}
        stageGroup={linkedDeal?.stage_group}
        stage={linkedDeal?.stage || site.pipeline_stage}
        signedIn={signedIn}
        workbookId={linkedDeal?.deal_id || site.linked_deal_id || ""}
        suggestedDrop={linkedDeal?.suggested_drop}
        blocker={linkedDeal}
      />
      {figuresReady ? <SiteNumbers site={site} deal={linkedDeal} /> : <FigureSkeleton />}
          </>
        )}
      />
      {related}
      <PanelSections
        overview={
          <>
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
                    {shownBroker(linkedDeal) ? <button className="text-link" type="button" data-testid="broker-link" onClick={() => onOpenParty?.(shownBroker(linkedDeal))}>{shownBroker(linkedDeal)}</button> : "Not provided"}
                    {linkedDeal.last_broker_contact ? ` · Last contact ${contactDate(linkedDeal.last_broker_contact)}` : ""}
                  </div>
                  <span>Firm</span>
                  <div>{shownFirm(linkedDeal) ? <button className="text-link" type="button" data-testid="firm-link" onClick={() => onOpenParty?.(shownFirm(linkedDeal))}>{shownFirm(linkedDeal)}</button> : "Not provided"}</div>
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
              <span>Nearest depot</span><div>{depotMiles == null ? (site.miles_to_depot == null ? "—" : `${site.miles_to_depot.toFixed(1)} mi`) : `${depotMiles.toFixed(1)} mi`}</div>
              <span>County parcel</span><div>{site.county_url ? <a href={site.county_url} target="_blank" rel="noopener noreferrer">Open county record</a> : "—"}</div>
              <span>Street View</span><div>{street ? <a href={street} target="_blank" rel="noopener noreferrer">Open Street View</a> : "—"}</div>
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
            <SitePacket site={site} deal={linkedDeal} hasPin={lat != null && lng != null} signedIn={signedIn} />
            <div className="kv">
              <span>Asking price</span>
              <div>
                {price || "Not on file"}
                {site.asking_price_source ? ` · ${site.asking_price_source}` : ""}
              </div>
              <span>Lot</span><div>{site.parcel_acres != null ? `${site.parcel_acres} ac` : acres(site.lot_ac)}{site.parcel_acres != null || site.lot_ac_source ? ` · ${site.lot_ac_source || "County assessor"}` : ""}</div>
              <span>Spare land</span><div>{(() => { const spare = spareLandSqft(linkedDeal?.open_land_sqft, site.spare_ac_own); return spare.note ? `${spare.value} · ${spare.note}` : spare.value; })()}</div>
              <span>Site capacity</span>
              <div><CapacityFacts facts={factsForSite(site, linkedDeal)} /></div>
              <span>Adjoining</span><div>{acres(site.spare_ac_adjoining, site.spare_ac_adjoining_text)}</div>
              <span>Zoning</span><div>{site.zoning || "—"}{site.zoning_source ? ` · ${site.zoning_source}` : ""}</div>
              <span>Traffic count</span><div>{universeTrafficLine(site) || "—"}</div>
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
}) {
  const packageHref = usePackageHref(deal.deal_id, signedIn);
  const hasPin = lat != null && lng != null;
  const photos = cardPhotos(deal, universeSite);
  const cash = cashTile(deal);
  const cue = listingCue(deal);
  return (
    <aside
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
      <DrawerGrip />
      <div className="drawer-head">
        <SheetHandle sheet={sheet} />
        <button className="close" type="button" aria-label="Close" onClick={onClose}><span aria-hidden="true">×</span></button>
      </div>
      {banner}
      <div className="drawer-scroll">
      <SitePhotos
        card={photos}
        between={(
          <>
      <div className="card-top">
        <h2>{deal.name || deal.address}</h2>
        <div className="card-chips">
          <StageChip deal={deal} />
          <AreaChip record={deal} />
          <NdaChip deal={deal} signedIn={signedIn} />
        </div>
        <p className="note">{deal.address}</p>
        <p className="note">{deal.deal_id}{deal.checked_live ? ` · ${checkedPhrase(deal.checked_live)}` : ""} · Asking {deal.asking_price_display || "not on file"}</p>
        <CardLinks
          listing={cue.url}
          folder={folderHref(deal.folder_url)}
          packageHref={packageHref}
          map={mapHref(lat, lng)}
          street={streetHref(lat, lng, photos.frontageUrl || deal.street_view_url)}
          signedIn={signedIn}
          listingTitle={deal.listing_removed ? "May be removed" : undefined}
        />
      </div>
      <NextStepCard
        kind="deal"
        id={deal.deal_id}
        stageGroup={deal.stage_group}
        stage={deal.stage}
        signedIn={signedIn}
        suggestedDrop={deal.suggested_drop}
        blocker={deal}
      />
      {figuresReady ? <DealHeadline deal={deal} censusAcres={universeSite?.spare_ac_own} /> : <FigureSkeleton />}
          </>
        )}
      />
      {related}
      <PanelSections
        overview={
          <>
            <h3>Broker</h3>
            <div className="kv">
              <span>Broker</span>
              <div>
                {shownBroker(deal) ? <button className="text-link" type="button" data-testid="broker-link" onClick={() => onOpenParty?.(shownBroker(deal))}>{shownBroker(deal)}</button> : "Not provided"}
                {deal.last_broker_contact ? ` · Last contact ${contactDate(deal.last_broker_contact)}` : ""}
              </div>
              <span>Firm</span>
              <div>{shownFirm(deal) ? <button className="text-link" type="button" data-testid="firm-link" onClick={() => onOpenParty?.(shownFirm(deal))}>{shownFirm(deal)}</button> : "Not provided"}</div>
              <span>Lead source</span><div>{leadSourceLine({ origin: deal.source_kind === "off-market" ? "off-market" : "universe", research_sources: "", verification: "" } as SiteProps, deal)}</div>
              <span>Stage</span><div>{stageDetail(deal.stage, deal.stage_group)}</div>
              <span>Parcel</span><div>{deal.parcel_match === "none" ? "No parcel found" : deal.parcel_match === "pin location" ? "Matched by pin location" : deal.parcel_match === "parcel number" ? "Matched by parcel number" : "Not matched"}</div>
              <span>Nearest depot</span><div>{depotMiles == null ? (hasPin ? "Not provided" : "No pin yet") : `${depotMiles.toFixed(1)} mi`}</div>
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
                <p>{universeTrafficLine(universeSite) || "Traffic count not on this universe row"}</p>
              </div>
            ) : hasPin ? (
              <p className="note" data-testid="universe-gap">This listing has a location and is not linked to a universe site yet.</p>
            ) : null}
          </>
        }
        numbers={
          <>
            {figuresReady ? <KeyStrip deal={deal} hasPin={hasPin} peers={peers || []} universeSite={universeSite} signedIn={signedIn} /> : null}
            <div className="kv">
              <span>Asking price</span>
              <div>
                {deal.asking_price_display || "Not provided"}
                {shownPriceSource(deal) ? ` · ${shownPriceSource(deal)}` : ""}
              </div>
              <span>Per acre</span>
              <div>{deal.price_per_acre != null ? fullMoney(deal.price_per_acre) : "Not provided"}</div>
              <span>Spare land</span>
              <div>{(() => { const spare = spareLandSqft(deal.open_land_sqft, universeSite?.spare_ac_own); return spare.note ? `${spare.value} · ${spare.note}` : spare.value; })()}</div>
              <span>Site capacity</span>
              <div><CapacityFacts facts={factsForDeal(deal)} /></div>
              {cash.hidden ? null : <span>{deal.stated_revenue_display && !deal.stated_cash_flow_display ? "Revenue" : "Cash flow"}</span>}
              {cash.hidden ? null : <div>{[cash.value, cash.note, cash.basis].filter(Boolean).join(" · ") || "Not provided"}</div>}
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
