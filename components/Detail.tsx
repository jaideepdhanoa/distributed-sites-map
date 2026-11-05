import type { ReactNode } from "react";
import type { DealProps, SiteProps, UnscreenedProps } from "@/lib/types";
import { cleanNote, formatRecordedDate, leadSourceLine, plainRoad, shownBroker, shownFirm, shownPriceSource } from "@/lib/format";
import DrawerGrip from "./DrawerGrip";
import Timeline from "./timeline/Timeline";
import { nextStepText, plainVerdict, stageDetail, stageTitle, statusOf, tierLabel } from "@/lib/labels";

function acres(value: number | null | undefined, text?: string) {
  if (text) return text;
  if (value == null) return "—";
  return `${value} ac`;
}

function websiteLabel(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//i, "");
  }
}

function mapsLinks(lat?: number | null, lng?: number | null) {
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) return null;
  const point = `${lat},${lng}`;
  return (
    <p className="map-links">
      <a href={`https://www.google.com/maps/search/?api=1&query=${point}`} target="_blank" rel="noopener noreferrer">Open in Google Maps</a>
      {" · "}
      <a href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${point}`} target="_blank" rel="noopener noreferrer">Street View</a>
    </p>
  );
}

export default function Detail({
  site,
  depotMiles,
  lat,
  lng,
  onOpenDeal,
  linkedDeal,
  onAddCompare,
  sameOwner,
  onClose,
  sheet,
  extras,
  banner,
}: {
  site: SiteProps | null;
  depotMiles?: number | null;
  lat?: number | null;
  lng?: number | null;
  onOpenDeal?: () => void;
  linkedDeal?: DealProps | null;
  onAddCompare?: () => void;
  sameOwner?: { site_id: string; name: string }[];
  onClose?: () => void;
  sheet?: { expanded: boolean; onToggle: () => void };
  extras?: ReactNode;
  banner?: ReactNode;
}) {
  if (!site) return null;
  const price = site.asking_price_display;
  const why = site.summary_why || "Not screened yet.";
  const next = nextStepText(site);
  const unscreened = !site.verdict && (!site.summary_why || site.summary_why === "Not screened yet.") && next === "Not screened yet.";
  return (
    <aside className={`drawer ${sheet?.expanded ? "expanded" : ""}`}>
      <DrawerGrip />
      <button className="sheet-handle" type="button" onClick={sheet?.onToggle}>{sheet?.expanded ? "Show less" : "Show more"}</button>
      {banner}
      <button className="close" type="button" onClick={onClose}>Close</button>
      <h2>{site.name || site.address || site.site_id}</h2>
      {site.also_known_as ? <p className="note">Also known as: {site.also_known_as}</p> : null}
      <p className="note">{site.address || "—"}</p>
      <p className="note">{site.site_id}</p>
      {mapsLinks(lat, lng)}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {site.land_tier ? <span className={`badge tier ${site.land_tier === "L10" ? "l10" : "l4"}`} title={tierLabel(site.land_tier)}><i className={`swatch ${site.land_tier === "L10" ? "l10" : "l4"}`} />{tierLabel(site.land_tier)}</span> : null}
        {site.tier_from_adjoining ? <span className="badge tier l4"><i className="swatch l4" />Tier from same-owner adjoining land</span> : null}
        <span className={`badge ${site.verdict === "PASS" ? "checked" : site.verdict === "FAIL" || site.verdict === "NOT_A_WASH" ? "gone" : "pending"}`} title={statusOf(site).note}>{statusOf(site).label}</span>
        {site.land_only ? <span className="badge pending">Land site</span> : null}
        {site.origin === "off-market" ? <span className="badge pending">Other off-market</span> : null}
        {site.linked_deal_id ? <span className="badge checked">Listed</span> : null}
      </div>
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
      {onAddCompare ? <button className="action" type="button" onClick={onAddCompare}>Add to compare</button> : null}
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
      <h3>Land</h3>
      <div className="kv">
        <span>Lot</span><div>{site.parcel_acres != null ? `${site.parcel_acres} ac` : acres(site.lot_ac)}{site.parcel_acres != null || site.lot_ac_source ? ` · ${site.lot_ac_source || "County assessor"}` : ""}</div>
        <span>Own spare</span><div>{acres(site.spare_ac_own, site.spare_ac_own_text)}</div>
        <span>Adjoining</span><div>{acres(site.spare_ac_adjoining, site.spare_ac_adjoining_text)}</div>
        <span>Zoning</span><div>{site.zoning || "—"}{site.zoning_source ? ` · ${site.zoning_source}` : ""}</div>
        <span>Traffic count</span><div>{site.aadt_count ? `${site.aadt_count} vehicles a day${site.aadt_road ? ` on ${plainRoad(site.aadt_road)}` : ""}${site.aadt_year ? ` (${site.aadt_year})` : ""}${site.aadt_source ? `. ${site.aadt_source}` : ""}` : "—"}</div>
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
      {price ? (
        <>
          <h3>Asking price</h3>
          <p>
            {price}
            {site.asking_price_source ? (
              <>
                {" · "}
                {site.asking_price_url ? (
                  <a href={site.asking_price_url} target="_blank" rel="noopener noreferrer">{site.asking_price_source}</a>
                ) : (
                  site.asking_price_source
                )}
              </>
            ) : null}
          </p>
        </>
      ) : null}
      <h3>Status</h3>
      <div className="kv">
        <span>Listed</span><div>{site.listed ? "Yes" : "No"}</div>
        <span>Contacted</span><div>{site.contacted ? "Yes" : "No"}</div>
        <span>Nearest depot</span><div>{depotMiles == null ? (site.miles_to_depot == null ? "—" : `${site.miles_to_depot.toFixed(1)} mi`) : `${depotMiles.toFixed(1)} mi`}</div>
        <span>County parcel</span><div>{site.county_url ? <a href={site.county_url} target="_blank" rel="noopener noreferrer">Open county record</a> : "—"}</div>
        <span>Street View</span><div>{site.street_view_url ? <a href={site.street_view_url} target="_blank" rel="noopener noreferrer">Open Street View</a> : "—"}</div>
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
      {extras}
      <Timeline recordId={site.site_id} relatedId={site.linked_deal_id || ""} />
    </aside>
  );
}

export function DealDetail({
  deal,
  universeName,
  depotMiles,
  lat,
  lng,
  onOpenSite,
  onClose,
  sheet,
  extras,
  banner,
}: {
  deal: DealProps;
  universeName?: string;
  depotMiles?: number | null;
  lat?: number | null;
  lng?: number | null;
  onOpenSite?: () => void;
  onClose?: () => void;
  sheet?: { expanded: boolean; onToggle: () => void };
  extras?: ReactNode;
  banner?: ReactNode;
}) {
  return (
    <aside className={`drawer ${sheet?.expanded ? "expanded" : ""}`}>
      <DrawerGrip />
      <button className="sheet-handle" type="button" onClick={sheet?.onToggle}>{sheet?.expanded ? "Show less" : "Show more"}</button>
      {banner}
      <button className="close" type="button" onClick={onClose}>Close</button>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <span className="badge pending">{deal.kind === "land" ? "Land site" : "Pipeline"}</span>
        <span className="badge checked">{stageTitle(deal.stage_group)}</span>
        {deal.broker_contacted ? <span className="badge pending" title={deal.last_broker_contact ? `Last contact ${deal.last_broker_contact}` : "An outbound email or call is on file"}>Broker contacted</span> : null}
        {deal.listed ? <span className="badge checked">Listed</span> : null}
      </div>
      <h2>{deal.name || deal.address}</h2>
      <p className="note">{deal.address}</p>
      <p className="note">{deal.deal_id}</p>
      {mapsLinks(lat, lng)}
      <h3>Broker</h3>
      <div className="kv">
        <span>Broker</span><div>{shownBroker(deal) || "—"}</div>
        <span>Firm</span><div>{shownFirm(deal) || "—"}</div>
        <span>Lead source</span><div>{leadSourceLine({ origin: deal.source_kind === "off-market" ? "off-market" : "universe", research_sources: "", verification: "" } as SiteProps, deal)}</div>
      </div>
      <h3>Listing</h3>
      <div className="kv">
        <span>Stage</span><div>{stageDetail(deal.stage, deal.stage_group)}</div>
        <span>Last broker contact</span><div>{deal.last_broker_contact || "—"}</div>
        <span>Asking price</span>
        <div>
          {deal.asking_price_display || "—"}
          {shownPriceSource(deal) ? ` · ${shownPriceSource(deal)}` : ""}
        </div>
        <span>Source</span>
        <div>
          {deal.source_kind !== "off-market" && deal.listing_url ? (
            <a href={deal.listing_url} target="_blank" rel="noopener noreferrer">{deal.source_line || "View listing"}</a>
          ) : (
            deal.source_line || "Source not on file"
          )}
        </div>
        <span>Listing</span>
        <div>
          {deal.listing_url ? (
            <a href={deal.listing_url} target="_blank" rel="noopener noreferrer">View listing</a>
          ) : deal.source_kind === "off-market" ? (
            "Off-market"
          ) : (
            "No listing link on file"
          )}
        </div>
        <span>Parcel</span>
        <div>{deal.parcel_match === "none" ? "No parcel found" : deal.parcel_match === "pin location" ? "Matched by pin location" : deal.parcel_match === "parcel number" ? "Matched by parcel number" : "—"}</div>
        <span>Next step</span><div>{deal.next_step || "—"}</div>
        <span>Nearest depot</span><div>{depotMiles == null ? "—" : `${depotMiles.toFixed(1)} mi`}</div>
      </div>
      {deal.universe_id ? (
        <>
          <h3>Universe site</h3>
          <p>
            <button className="text-link" type="button" onClick={onOpenSite}>{universeName || deal.universe_id}</button>
          </p>
        </>
      ) : null}
      {extras}
      <Timeline recordId={deal.deal_id} relatedId={deal.universe_id || ""} />
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
