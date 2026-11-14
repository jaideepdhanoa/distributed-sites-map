import type { DealProps } from "@/lib/types";
import { basisBadge } from "@/lib/pricing";

function Mark({ badge, reason }: { badge?: string; reason?: string }) {
  const word = basisBadge(badge);
  if (reason) return <small>{reason}</small>;
  if (word) return <em>{word}</em>;
  return null;
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

function shown(value?: string | null) {
  const text = (value || "").trim();
  return text && text !== "—" ? text : "";
}

export default function PricingSection({ deal }: { deal: DealProps }) {
  const landShown = deal.land_estimate != null;
  const earningsName = deal.earnings_multiple_which ? `Asking / ${deal.earnings_multiple_which}` : "Asking / cash flow";
  const revenueShown = shown(deal.revenue_multiple_display);
  const earningsShown = shown(deal.earnings_multiple_display);
  const businessShown = shown(deal.business_multiple_display);
  const businessValue = shown(deal.business_value_display);
  return (
    <section data-testid="pricing">
      <h3 className="job">Pricing</h3>
      <AskingSplit deal={deal} />
      <div className="metrics">
        <article>
          <span>Land estimate</span>
          <strong title={landShown ? deal.land_estimate_tip || undefined : undefined}>{deal.land_estimate_display || "—"}</strong>
          <Mark badge={landShown ? "Estimate" : ""} reason={landShown ? "" : deal.land_estimate_reason} />
        </article>
        <article>
          <span>Business value</span>
          <strong>{businessValue || "—"}</strong>
          <Mark reason={businessValue ? "" : deal.business_value_reason} />
        </article>
        <article className="wide">
          <span>County value (land + buildings)</span>
          <strong title={deal.county_value_basis || undefined}>{deal.county_value_display || "—"}</strong>
          {deal.county_value != null && deal.county_value_basis ? <small>{deal.county_value_basis}</small> : null}
        </article>
        <article>
          <span>Asking / revenue</span>
          <strong>{revenueShown || "—"}</strong>
          <Mark badge={deal.revenue_multiple_basis} reason={revenueShown ? "" : deal.revenue_multiple_reason} />
        </article>
        <article>
          <span>{earningsName}</span>
          <strong>{earningsShown || "—"}</strong>
          <Mark badge={deal.earnings_multiple_basis} reason={earningsShown ? "" : deal.earnings_multiple_reason} />
        </article>
        <article className="wide">
          <span>Business-only multiple</span>
          <strong>{businessShown || "—"}</strong>
          <Mark badge={deal.business_multiple_basis} reason={businessShown ? "" : deal.business_multiple_reason} />
        </article>
      </div>
    </section>
  );
}
