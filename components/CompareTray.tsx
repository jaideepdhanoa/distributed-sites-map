import type { DealProps, SiteProps } from "@/lib/types";
import { acresText, cashTile, depotLine, openLandText } from "@/lib/keyNumbers";
import { stageDetail } from "@/lib/labels";

export default function CompareTray({
  deals,
  sites,
  onRemove,
  onClose,
}: {
  deals: DealProps[];
  sites: SiteProps[];
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const count = deals.length + sites.length;
  if (!count) return null;
  return (
    <aside className="compare-tray" data-testid="compare-tray">
      <div className="compare-bar">
        <strong>Compare</strong>
        {deals.map((deal) => (
          <button key={deal.deal_id} type="button" onClick={() => onRemove(deal.deal_id)}>
            {deal.name || deal.address}
            <span aria-hidden="true"> ×</span>
          </button>
        ))}
        {sites.map((site) => (
          <button key={site.site_id} type="button" onClick={() => onRemove(site.site_id)}>
            {site.name || site.address}
            <span aria-hidden="true"> ×</span>
          </button>
        ))}
        <button type="button" className="compare-go" disabled={count < 2}>
          Compare {count}
        </button>
        <button type="button" onClick={onClose}>Clear</button>
      </div>
      {count >= 2 ? (
        <div className="compare-grid">
          {deals.map((deal) => {
            const cash = cashTile(deal);
            return (
              <article key={deal.deal_id}>
                <h3>{deal.name || deal.address}</h3>
                <p>{stageDetail(deal.stage, deal.stage_group)}</p>
                <p>Asking {deal.asking_price_display || "Not provided"}</p>
                <p>Land {acresText(deal.land_acres) || "Not provided"}</p>
                <p>Per acre {deal.price_per_acre_display || "Not provided"}</p>
                <p>Open land {deal.open_land_sqft != null ? openLandText(deal.open_land_sqft) : "Not measured"}</p>
                <p>Depot {depotLine(deal.miles_to_depot, deal.miles_to_depot != null)}</p>
                <p>Cash flow {cash.value}</p>
              </article>
            );
          })}
          {sites.map((site) => (
            <article key={site.site_id}>
              <h3>{site.name || site.address}</h3>
              <p>{site.address}</p>
              <p>{site.owner || "Owner not on file"}</p>
              <p>{site.zoning || "Zoning not on file"}</p>
            </article>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
