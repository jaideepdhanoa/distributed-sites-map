import type { DealProps, SiteProps } from "@/lib/types";
import { stageDetail, stageTitle, statusOf } from "@/lib/labels";

function acres(value: number | null | undefined, text?: string) {
  if (text) return text;
  if (value == null) return "—";
  return `${value} ac`;
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
  onClose,
}: {
  site: SiteProps | null;
  depotMiles?: number | null;
  lat?: number | null;
  lng?: number | null;
  onOpenDeal?: () => void;
  onClose?: () => void;
}) {
  if (!site) return null;
  const reasons = [site.evidence, site.why_stopped, site.elimination_reason].filter((line, index, all) => line && all.indexOf(line) === index);
  const price = site.asking_price_display;
  return (
    <aside className="drawer">
      <button className="close" type="button" onClick={onClose}>Close</button>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {site.land_tier ? <span className={`badge ${site.land_tier === "L10" ? "l10" : "l4"}`}>{site.land_tier}</span> : null}
        {site.tier_from_adjoining ? <span className="badge l4">Tier from same-owner adjoining land</span> : null}
        <span className={`badge ${site.verdict === "PASS" ? "checked" : site.verdict === "FAIL" || site.verdict === "NOT_A_WASH" ? "gone" : "pending"}`} title={statusOf(site).note}>{statusOf(site).label}</span>
        {site.land_only ? <span className="badge pending">Land site</span> : null}
        {site.linked_deal_id ? <span className="badge checked">Listed</span> : null}
      </div>
      <h2>{site.name || site.address || site.site_id}</h2>
      <p className="note">{site.address || "—"}</p>
      <p className="note">{site.site_id}</p>
      {mapsLinks(lat, lng)}
      <h3>Owner</h3>
      <p>{site.owner || "—"}</p>
      <h3>Land</h3>
      <div className="kv">
        <span>Lot</span><div>{site.parcel_acres != null ? `${site.parcel_acres} ac` : acres(site.lot_ac)}{site.parcel_acres != null || site.lot_ac_source ? ` · ${site.lot_ac_source || "County assessor"}` : ""}</div>
        <span>Own spare</span><div>{acres(site.spare_ac_own, site.spare_ac_own_text)}</div>
        <span>Adjoining</span><div>{acres(site.spare_ac_adjoining, site.spare_ac_adjoining_text)}</div>
      </div>
      <h3>Verdict</h3>
      <div className="kv">
        <span>Verdict</span><div>{site.verdict || "Not checked"}</div>
        <span>Utility proximity</span><div>{site.utility_proximity || "Unknown"}</div>
        <span>Tenure</span><div>{site.tenure || "—"}</div>
      </div>
      {site.research_sources ? (
        <>
          <h3>Research sources</h3>
          <p>{site.research_sources}</p>
          {site.research_note ? <p>{site.research_note}</p> : null}
        </>
      ) : null}
      {reasons.length ? reasons.map((reason) => <p key={reason}>{reason}</p>) : null}
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
        <span>Nearest depot</span><div>{depotMiles == null ? "—" : `${depotMiles.toFixed(1)} mi`}</div>
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
}: {
  deal: DealProps;
  universeName?: string;
  depotMiles?: number | null;
  lat?: number | null;
  lng?: number | null;
  onOpenSite?: () => void;
  onClose?: () => void;
}) {
  return (
    <aside className="drawer">
      <button className="close" type="button" onClick={onClose}>Close</button>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <span className="badge pending">{deal.kind === "land" ? "Land site" : "Pipeline"}</span>
        <span className="badge checked">{stageTitle(deal.stage_group)}</span>
        {deal.listed ? <span className="badge l10">Listed</span> : null}
      </div>
      <h2>{deal.name || deal.address}</h2>
      <p className="note">{deal.address}</p>
      <p className="note">{deal.deal_id}</p>
      {mapsLinks(lat, lng)}
      <h3>Broker</h3>
      <div className="kv">
        <span>Broker</span><div>{deal.broker || "—"}</div>
        <span>Firm</span><div>{deal.firm || "—"}</div>
      </div>
      <h3>Listing</h3>
      <div className="kv">
        <span>Stage</span><div>{stageDetail(deal.stage, deal.stage_group)}</div>
        <span>Asking price</span>
        <div>
          {deal.asking_price_display || "—"}
          {deal.asking_price_source ? ` · ${deal.asking_price_source}` : ""}
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
    </aside>
  );
}
