import type { SiteProps } from "@/lib/types";

function acres(value: number | null, text: string) {
  if (text) return text;
  if (value == null) return "—";
  return `${value} ac`;
}

function Dot({ status }: { status?: string }) {
  const color = status === "verified" ? "#1f6b45" : status === "inferred" ? "#c4841d" : "#b7b1a8";
  return <i className="dot" style={{ background: color }} title={status || "unknown"} />;
}

export default function Detail({ site }: { site: SiteProps | null }) {
  if (!site) return <aside className="detail"><p className="note">Select a site on the map or in the table.</p></aside>;
  const verification = site.verification === "county-checked" ? "checked" : "pending";
  return (
    <aside className="detail">
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {site.land_tier ? <span className={`badge ${site.land_tier === "L10" ? "l10" : "l4"}`}>{site.land_tier}</span> : null}
        {site.tier_from_adjoining ? <span className="badge l4">Tier from same-owner adjoining land</span> : null}
        <span className={`badge ${verification}`}>{site.verification}</span>
        {site.network_status === "held" ? <span className="badge held">Held for network expansion</span> : null}
        {site.verdict === "NOT_A_WASH" ? <span className="badge gone">Eliminated · {site.elimination_reason}</span> : null}
        {site.tenure_fail ? <span className="badge gone">FAIL on tenure</span> : null}
      </div>
      <h2>{site.name || site.address || site.site_id}</h2>
      <p className="note">{site.site_id} · {site.city} · {site.address}</p>
      {site.why_stopped ? <p>{site.why_stopped}</p> : null}
      <h3>Parcel</h3>
      <div className="kv">
        <span>APN</span><div>{site.apn || "—"}</div>
        <span>Class</span><div>{site.site_class}</div>
        <span>Lot</span><div>{site.lot_ac == null ? "—" : `${site.lot_ac} ac`}</div>
        <span>Ring</span><div>{site.service_ring || "—"}</div>
        <span>Record</span><div>{site.county_url ? <a href={site.county_url} target="_blank" rel="noreferrer">County page</a> : "—"}</div>
        <span>Street</span><div>{site.street_view_url ? <a href={site.street_view_url} target="_blank" rel="noreferrer">Street view</a> : "—"}</div>
      </div>
      <h3>Owner</h3>
      <p><Dot status={site.fields.owner?.status} />{site.owner || "—"}</p>
      <h3>Land</h3>
      <div className="kv">
        <span>Own parcel</span><div><Dot status={site.fields.spare?.status} />{acres(site.spare_ac_own, site.spare_ac_own_text)}</div>
        <span>Adjoining</span><div>{acres(site.spare_ac_adjoining, site.spare_ac_adjoining_text)}</div>
        <span>Control</span><div>{site.land_control === "own_parcel" ? "Own parcel" : site.land_control === "same_owner_adjoining" ? "Same-owner adjoining" : "—"}</div>
        <span>Aerial code</span><div>{site.aerial_fit || "—"}</div>
      </div>
      <h3>Verdict</h3>
      <div className="kv">
        <span>Verdict</span><div>{site.verdict || "No county verdict yet"}</div>
        <span>Confidence</span><div>{site.confidence}</div>
        <span>Our tier</span><div>{site.reconciliation_tier || "—"}</div>
        <span>Other review</span><div>{site.muse_verdict || "—"}</div>
      </div>
      {site.evidence ? <p>{site.evidence}</p> : null}
      {site.scale_note ? <p className="note">{site.scale_note}</p> : null}
      {site.acreage_note ? <p className="note">{site.acreage_note}</p> : null}
      {(site.reviews ?? []).length ? (
        <table>
          <thead><tr><th>Who</th><th>Call</th><th>When</th></tr></thead>
          <tbody>
            {site.reviews.map((review, index) => (
              <tr key={`${review.reviewer}-${review.date}-${index}`}>
                <td>{review.reviewer}{review.provisional ? " · provisional" : ""}</td>
                <td>{review.verdict}</td>
                <td>{review.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <h3>Pipeline</h3>
      <div className="kv">
        <span>Stage</span><div>{site.pipeline_stage || "—"}</div>
        <span>Asking price</span><div>{site.asking_price_display || "—"}</div>
        <span>Source</span>
        <div>
          {site.asking_price_url ? <a href={site.asking_price_url} target="_blank" rel="noreferrer">{site.asking_price_source || "Listing"}</a> : (site.asking_price_source || "—")}
          {site.asking_price_date ? ` · ${site.asking_price_date}` : ""}
          {site.asking_price_status ? ` · ${site.asking_price_status}` : ""}
        </div>
        <span>Listed</span><div>{site.listed ? "Yes" : "No"}</div>
        <span>Contacted</span><div>{site.contacted ? "Stage 2 or later" : "Not yet"}</div>
      </div>
      <h3>Signals</h3>
      <div className="kv">
        <span>Utility proximity</span><div>{site.utility_proximity || "Unknown"}</div>
        <span>Tenure</span><div>{site.tenure || "—"}{site.tenure_fail ? " · FAIL on tenure" : ""}</div>
        <span>Flood</span><div>{site.flood_zone || "—"}</div>
        <span>Zoning</span><div>{site.zoning || "—"}</div>
        <span>Tanks</span><div>{site.tank_status || "—"}</div>
        <span>Nearest depot</span><div>{site.miles_to_depot == null ? "—" : `${site.miles_to_depot} mi`}</div>
      </div>
      {site.land_only ? <p className="note">Land only. Ruled out 2 Nov. Shown because the land-sites toggle is on.</p> : null}
      <p className="note">Utility proximity is Strong, OK, Weak, or Unknown. Strong is closer to heavy supply.</p>
    </aside>
  );
}
