import type { DealProps } from "@/lib/types";
import { basisBadge } from "@/lib/pricing";

function badge(value: string | null | undefined, shown: boolean) {
  if (!shown) return "—";
  return basisBadge(value) || "—";
}

function AskingSplit({ deal }: { deal: DealProps }) {
  const asking = deal.asking_price;
  const land = deal.land_estimate;
  if (asking == null || asking <= 0 || land == null) return null;
  const landPct = Math.max(0, Math.min(100, (land / asking) * 100));
  return (
    <div className="split-bar" title="Asking split into the land estimate and the business value">
      <span className="split-land" style={{ width: `${landPct}%` }} />
      <span className="split-business" style={{ width: `${Math.max(0, 100 - landPct)}%` }} />
    </div>
  );
}

export default function PricingSection({ deal }: { deal: DealProps }) {
  const landShown = deal.land_estimate != null;
  const earningsName = deal.earnings_multiple_which ? `Asking / ${deal.earnings_multiple_which}` : "Asking / cash flow";
  return (
    <section data-testid="pricing">
      <h3 className="job">Pricing</h3>
      <AskingSplit deal={deal} />
      <div className="metrics">
        <article>
          <span>Land estimate</span>
          <strong title={landShown ? deal.land_estimate_tip || undefined : undefined}>{deal.land_estimate_display || "—"}</strong>
          <em>{landShown ? "Estimate" : "—"}</em>
        </article>
        <article>
          <span>Business value</span>
          <strong>{deal.business_value_display || "—"}</strong>
        </article>
        <article className="wide">
          <span>County value (land + buildings)</span>
          <strong>{deal.county_value_display || "—"}</strong>
          <small>{deal.county_value != null ? (deal.county_value_basis || "—") : "—"}</small>
        </article>
        <article>
          <span>Asking / revenue</span>
          <strong>{deal.revenue_multiple_display || "—"}</strong>
          <em>{badge(deal.revenue_multiple_basis, Boolean(deal.revenue_multiple_display && deal.revenue_multiple_display !== "—"))}</em>
        </article>
        <article>
          <span>{earningsName}</span>
          <strong>{deal.earnings_multiple_display || "—"}</strong>
          <em>{badge(deal.earnings_multiple_basis, Boolean(deal.earnings_multiple_display && deal.earnings_multiple_display !== "—"))}</em>
        </article>
        <article className="wide">
          <span>Business-only multiple</span>
          <strong>{deal.business_multiple_display || "—"}</strong>
          <em>{badge(deal.business_multiple_basis, Boolean(deal.business_multiple_display && deal.business_multiple_display !== "—"))}</em>
        </article>
      </div>
    </section>
  );
}
