import type { ReactNode } from "react";
import type { DealProps, SiteProps, UnscreenedProps } from "@/lib/types";
import { cleanNote, formatRecordedDate, leadSourceLine, listingCue, shownBroker, shownFirm, shownPriceSource } from "@/lib/format";
import DrawerGrip from "./DrawerGrip";
import { NextStepCard } from "./actions/NextStepCard";
import Timeline from "./timeline/Timeline";
import { spareTier } from "@/lib/filter";
import { nextStepText, plainVerdict, stageDetail, stageTone, statusOf, tierLabel } from "@/lib/labels";
import { acreUnit, checkedPhrase, factsForDeal, factsForSite, fullMoney, openLandText, universeTrafficLine } from "@/lib/keyNumbers";
import { cardPhotos, isPanoUrl } from "@/lib/photos";
import KeyStrip, { CapacityFacts } from "./KeyStrip";
import PanelSections from "./PanelSections";
import SitePhotos from "./SitePhotos";

function acres(value: number | null | undefined, text?: string) {
  const shown = acreUnit(value, text);
  return shown || "—";
}

function spareRows(site?: SiteProps | null, deal?: DealProps | null) {
  const rows: { label: string; value: string; basis: string }[] = [];
  if (deal?.open_land_sqft != null) {
    rows.push({ label: "Workbook spare", value: openLandText(deal.open_land_sqft), basis: deal.open_land_basis || "Estimated" });
  }
  if (site?.spare_ac_own != null) {
    rows.push({ label: "Universe own spare", value: acreUnit(site.spare_ac_own, site.spare_ac_own_text), basis: "Own parcel" });
  }
  if (!rows.length) rows.push({ label: "Spare land", value: "Not measured", basis: "No aerial check yet" });
  return rows;
}

function GradePair({
  site,
  deal,
  prefer,
}: {
  site?: SiteProps | null;
  deal?: DealProps | null;
  prefer: "site" | "deal";
}) {
  const rows = spareRows(site, deal);
  const facts = prefer === "site" ? factsForSite(site, deal) : factsForDeal(deal);
  return (
    <div className="grade-pair" data-testid="grade-pair">
      {rows.map((row) => (
        <article key={row.label}>
          <span>{row.label}</span>
          <strong>{row.value}</strong>
          <small>{row.basis}</small>
        </article>
      ))}
      <article className="facts">
        <span>Site capacity</span>
        <CapacityFacts facts={facts} />
      </article>
    </div>
  );
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
        <>
          {hasMap ? " · " : null}
          <a href={street} target="_blank" rel="noopener noreferrer" data-testid="street-view-link">Street View</a>
        </>
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
  sameOwner,
  onClose,
  sheet,
  extras,
  banner,
  onSwipe,
}: {
  site: SiteProps | null;
  depotMiles?: number | null;
  lat?: number | null;
  lng?: number | null;
  onOpenDeal?: () => void;
  onOpenParty?: (name: string) => void;
  linkedDeal?: DealProps | null;
  onAddCompare?: () => void;
  sameOwner?: { site_id: string; name: string }[];
  onClose?: () => void;
  sheet?: { expanded: boolean; onToggle: () => void };
  extras?: ReactNode;
  banner?: ReactNode;
  onSwipe?: (direction: "next" | "prev") => void;
}) {
  if (!site) return null;
  const photos = cardPhotos(site, linkedDeal);
  const street = photos.frontageUrl || site.street_view_url;
  const price = site.asking_price_display;
  const why = site.summary_why || "Not screened yet.";
  const next = nextStepText(site);
  const unscreened = !site.verdict && (!site.summary_why || site.summary_why === "Not screened yet.") && next === "Not screened yet.";
  return (
    <aside
      className={`drawer ${sheet?.expanded ? "expanded" : ""}`}
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
      <button className="sheet-handle" type="button" onClick={sheet?.onToggle}>{sheet?.expanded ? "Show less" : "Show more"}</button>
      {banner}
      <button className="close" type="button" onClick={onClose}>Close</button>
      <h2>{site.name || site.address || site.site_id}</h2>
      {site.also_known_as ? <p className="note">Also known as: {site.also_known_as}</p> : null}
      <p className="note">{site.address || "—"}</p>
      <p className="note">{site.site_id}{price ? ` · Asking ${price}` : ""}</p>
      {mapsLinks(lat, lng, linkedDeal?.listing_url ? linkedDeal : null, false, site.folder_url || linkedDeal?.folder_url, photos.frontageUrl)}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {spareTier(site) ? <span className={`badge tier ${spareTier(site) === "L10" ? "l10" : "l4"}`} title={tierLabel(spareTier(site))}><i className={`swatch ${spareTier(site) === "L10" ? "l10" : "l4"}`} />{tierLabel(spareTier(site))}</span> : null}
        {site.tier_from_adjoining ? <span className="badge tier l4"><i className="swatch l4" />Tier from same-owner adjoining land</span> : null}
        <span className={`badge ${site.verdict === "PASS" ? "checked" : site.verdict === "FAIL" || site.verdict === "NOT_A_WASH" ? "gone" : "pending"}`} title={statusOf(site).note}>{statusOf(site).label}</span>
        {site.land_only ? <span className="badge pending">Land site</span> : null}
        {site.origin === "off-market" ? <span className="badge pending">Other off-market</span> : null}
        {site.linked_deal_id ? <span className="badge checked">Listed</span> : null}
      </div>
      {onAddCompare ? <button className="action" type="button" onClick={onAddCompare}>Add to compare</button> : null}
      <GradePair site={site} deal={linkedDeal} prefer="site" />
      <SitePhotos card={photos} />
      <NextStepCard kind="site" id={site.site_id} />
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
            {linkedDeal && (shownBroker(linkedDeal) || shownFirm(linkedDeal)) ? (
              <>
                <h3>Broker</h3>
                <div className="kv">
                  <span>Broker</span>
                  <div>{shownBroker(linkedDeal) ? <button className="text-link" type="button" data-testid="broker-link" onClick={() => onOpenParty?.(shownBroker(linkedDeal))}>{shownBroker(linkedDeal)}</button> : "Not provided"}</div>
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
              <details>
                <summary>Research notes</summary>
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
        numbers={
          <>
            <div className="kv">
              <span>Asking price</span>
              <div>
                {price || "Not on file"}
                {site.asking_price_source ? ` · ${site.asking_price_source}` : ""}
              </div>
              <span>Lot</span><div>{site.parcel_acres != null ? `${site.parcel_acres} ac` : acres(site.lot_ac)}{site.parcel_acres != null || site.lot_ac_source ? ` · ${site.lot_ac_source || "County assessor"}` : ""}</div>
              <span>Universe own spare</span><div>{acres(site.spare_ac_own, site.spare_ac_own_text)}</div>
              {linkedDeal?.open_land_sqft != null ? <><span>Workbook spare</span><div>{openLandText(linkedDeal.open_land_sqft)} · {linkedDeal.open_land_basis || "Estimated"}</div></> : null}
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
        }
        activity={<Timeline recordId={site.site_id} relatedId={site.linked_deal_id || ""} />}
        discussion={extras}
      />
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
  compared,
  sheet,
  extras,
  banner,
  onSwipe,
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
  compared?: boolean;
  sheet?: { expanded: boolean; onToggle: () => void };
  extras?: ReactNode;
  banner?: ReactNode;
  onSwipe?: (direction: "next" | "prev") => void;
}) {
  const hasPin = lat != null && lng != null;
  const photos = cardPhotos(deal, universeSite);
  return (
    <aside
      className={`drawer ${sheet?.expanded ? "expanded" : ""}`}
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
      <button className="sheet-handle" type="button" onClick={sheet?.onToggle}>{sheet?.expanded ? "Show less" : "Show more"}</button>
      {banner}
      <button className="close" type="button" onClick={onClose}>Close</button>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <span className={`stage-pill tone-${stageTone(deal)}`}>{stageDetail(deal.stage, deal.stage_group)}</span>
        {deal.broker_contacted ? <span className="badge pending" title={deal.last_broker_contact ? `Last contact ${deal.last_broker_contact}` : "An outbound email or call is on file"}>Broker contacted</span> : null}
        {deal.listed ? <span className="badge checked">Listed</span> : null}
      </div>
      <h2>{deal.name || deal.address}</h2>
      <p className="note">{deal.address}</p>
      <p className="note">{deal.deal_id}{deal.checked_live ? ` · ${checkedPhrase(deal.checked_live)}` : ""} · Asking {deal.asking_price_display || "not on file"}</p>
      {mapsLinks(lat, lng, deal, true, deal.folder_url, photos.frontageUrl)}
      {onCompare ? (
        <label className="compare-check">
          <input type="checkbox" checked={Boolean(compared)} onChange={(event) => onCompare?.(event.currentTarget.checked)} />
          Compare
        </label>
      ) : null}
      <KeyStrip deal={deal} hasPin={hasPin} peers={peers || []} />
      <GradePair site={universeSite} deal={deal} prefer="deal" />
      <SitePhotos card={photos} />
      <NextStepCard kind="deal" id={deal.deal_id} />
      <PanelSections
        overview={
          <>
            <h3>Broker</h3>
            <div className="kv">
              <span>Broker</span>
              <div>{shownBroker(deal) ? <button className="text-link" type="button" data-testid="broker-link" onClick={() => onOpenParty?.(shownBroker(deal))}>{shownBroker(deal)}</button> : "Not provided"}</div>
              <span>Firm</span>
              <div>{shownFirm(deal) ? <button className="text-link" type="button" data-testid="firm-link" onClick={() => onOpenParty?.(shownFirm(deal))}>{shownFirm(deal)}</button> : "Not provided"}</div>
              <span>Lead source</span><div>{leadSourceLine({ origin: deal.source_kind === "off-market" ? "off-market" : "universe", research_sources: "", verification: "" } as SiteProps, deal)}</div>
              <span>Stage</span><div>{stageDetail(deal.stage, deal.stage_group)}</div>
              <span>Last broker contact</span><div>{deal.last_broker_contact || "—"}</div>
              <span>Parcel</span><div>{deal.parcel_match === "none" ? "No parcel found" : deal.parcel_match === "pin location" ? "Matched by pin location" : deal.parcel_match === "parcel number" ? "Matched by parcel number" : "Not matched"}</div>
              <span>Nearest depot</span><div>{depotMiles == null ? (hasPin ? "Not provided" : "No pin yet") : `${depotMiles.toFixed(1)} mi`}</div>
              <span>Listing</span>
              <div>
                {deal.listing_url ? (
                  <a href={deal.listing_url} target="_blank" rel="noopener noreferrer">{listingCue(deal).label}</a>
                ) : (
                  listingCue(deal).label
                )}
              </div>
              <span>Next step</span><div>{deal.next_step || "Not provided"}</div>
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
            <div className="kv">
              <span>Asking price</span>
              <div>
                {deal.asking_price_display || "Not provided"}
                {shownPriceSource(deal) ? ` · ${shownPriceSource(deal)}` : ""}
              </div>
              <span>Per acre</span>
              <div>{deal.price_per_acre != null ? fullMoney(deal.price_per_acre) : "Not provided"}</div>
              <span>Open land</span>
              <div>{deal.open_land_sqft != null ? openLandText(deal.open_land_sqft) : "Not measured"}</div>
              <span>Site capacity</span>
              <div><CapacityFacts facts={factsForDeal(deal)} /></div>
              <span>{deal.stated_revenue_display && !deal.stated_cash_flow_display ? "Revenue" : "Cash flow"}</span>
              <div>
                {deal.stated_cash_flow_display
                  ? `${deal.stated_cash_flow_display}${deal.cash_flow_label ? ` · ${deal.cash_flow_label}` : ""}${deal.figures_basis ? ` · ${deal.figures_basis}` : ""}${deal.package_status ? ` · Package ${deal.package_status}` : ""}`
                  : deal.figures_status === "withheld"
                  ? "Package figures not shown"
                  : deal.stated_revenue_display || (deal.kind === "land" ? "Vacant land, no business" : "Not provided")}
              </div>
            </div>
          </>
        }
        activity={<Timeline recordId={deal.deal_id} relatedId={deal.universe_id || ""} />}
        discussion={extras}
      />
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
  sheet?: { expanded: boolean; onToggle: () => void };
}) {
  return (
    <aside className={`drawer ${sheet?.expanded ? "expanded" : ""}`}>
      <button className="sheet-handle" type="button" onClick={sheet?.onToggle}>{sheet?.expanded ? "Show less" : "Show more"}</button>
      <button className="close" type="button" onClick={onClose}>Close</button>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <span className="badge pending">Listed, not yet screened</span>
        <span className="badge checked">{row.kind}</span>
        {row.approximate ? <span className="badge pending">Approximate location</span> : null}
        {!row.pinned ? <span className="badge pending">Address withheld</span> : null}
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
    </aside>
  );
}
