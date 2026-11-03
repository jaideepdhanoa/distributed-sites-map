import type { SiteProps } from "@/lib/types";

function acres(value: number | null | undefined, text?: string) {
  if (text) return text;
  if (value == null) return "—";
  return `${value} ac`;
}

export default function Detail({ site, onClose }: { site: SiteProps | null; onClose?: () => void }) {
  if (!site) return null;
  const reasons = [site.evidence, site.why_stopped, site.elimination_reason].filter((line, index, all) => line && all.indexOf(line) === index);
  const price = site.asking_price_display;
  return (
    <aside className="drawer">
      <button className="close" type="button" onClick={onClose}>Close</button>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {site.land_tier ? <span className={`badge ${site.land_tier === "L10" ? "l10" : "l4"}`}>{site.land_tier}</span> : null}
        {site.tier_from_adjoining ? <span className="badge l4">Tier from same-owner adjoining land</span> : null}
        {site.verdict ? <span className={`badge ${site.verdict === "PASS" ? "checked" : site.verdict === "FAIL" || site.verdict === "NOT_A_WASH" ? "gone" : "pending"}`}>{site.verdict}</span> : null}
        {site.network_status === "held" ? <span className="badge held">Held PASS</span> : null}
        {site.network_status === "cleared" ? <span className="badge checked">Cleared</span> : null}
        {site.land_only ? <span className="badge pending">Land site</span> : null}
      </div>
      <h2>{site.name || site.address || site.site_id}</h2>
      <p className="note">{site.address || "—"}</p>
      <p className="note">{site.site_id}</p>
      <h3>Owner</h3>
      <p>{site.owner || "—"}</p>
      <h3>Land</h3>
      <div className="kv">
        <span>Lot</span><div>{acres(site.lot_ac)}</div>
        <span>Own spare</span><div>{acres(site.spare_ac_own, site.spare_ac_own_text)}</div>
        <span>Adjoining</span><div>{acres(site.spare_ac_adjoining, site.spare_ac_adjoining_text)}</div>
      </div>
      <h3>Verdict</h3>
      <div className="kv">
        <span>Verdict</span><div>{site.verdict || "Not checked"}</div>
        <span>Utility proximity</span><div>{site.utility_proximity || "Unknown"}</div>
        <span>Tenure</span><div>{site.tenure || "—"}</div>
      </div>
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
                  <a href={site.asking_price_url} target="_blank" rel="noreferrer">{site.asking_price_source}</a>
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
      </div>
    </aside>
  );
}
