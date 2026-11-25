import FinancialsEntry from "./FinancialsEntry";
import type { ComponentProps } from "react";
import PricingSection from "./PricingSection";
import { dealRows, MISSING, siteRows } from "@/lib/comparison";
import type { SiteProps, DealProps } from "@/lib/types";

export default function Economics({
  deal,
  site,
  signedIn,
  pnl,
}: {
  deal?: DealProps | null;
  site?: SiteProps | null;
  signedIn?: boolean;
  pnl?: ComponentProps<typeof FinancialsEntry>["loaded"];
}) {
  if (!signedIn) return <p>Sign in to view financial evidence.</p>;
  const rows = deal
    ? dealRows(deal, site ? [site] : [], true)
    : site
      ? siteRows(site, [], true)
      : [];
  return (
    <section className="investment-economics"><h3>What does the asking price buy?</h3>
      {deal && deal.kind !== "land" && <PricingSection deal={deal} />}
      <h4>Savings versus hub at screening price</h4><p>{deal?.saving_vs_hub?.trim() || "Screening comparison not on file"}</p>
      <h4>Financial evidence · deal record</h4>
      {deal && deal.kind !== "land" && pnl?.statement?.status === "ready" && <FinancialsEntry dealId={deal.deal_id} loaded={pnl} compact="link" />}
      <dl className="record-economics">
      {[
        "Asking",
        "Revenue",
        "EBITDA",
        "Cash flow",
        ...(deal && deal.kind !== "land" ? [] : ["Asking / earnings", "Land estimate"]),
        "Figure basis",
        "Financial source",
        "Reporting period",
        "Financial package",
      ].map((label) => {
        const row = rows.find((item) => item.label === label);
        return (
          <div key={label} data-financial-measure={label}>
            <dt>{label}</dt>
            <dd>
              {row?.value && row.value !== MISSING ? row.value : "Not on file"}
            </dd>
          </div>
        );
      })}
    </dl></section>
  );
}
