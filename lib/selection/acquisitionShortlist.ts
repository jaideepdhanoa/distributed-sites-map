import { diligenceLayout } from "../charging/diligenceLayout";
import type { ChargingSummary } from "../charging/summary";
import type { OpportunitySite } from "./opportunity";

type Site = {
  charging?: ChargingSummary;
  stage?: string | null;
  stage_group?: string | null;
  pendingDrop?: boolean;
  suggested_drop?: string | null;
  listing_removed?: boolean;
  chargingHold?: string;
};

const purchaseRoutes = new Set(["Operating acquisition", "Offered acquisition", "Property only", "Site lead"]);
const openDecisions = new Set(["Investigate", "Shortlist", "Reserve", "Hold"]);

/** Derive current diligence membership while retaining the register's evidence and visit plan. */
export function acquisitionReview(review: OpportunitySite | undefined, site: Site): OpportunitySite | undefined {
  if (!review || !openDecisions.has(review.primary.disposition)) return review;
  const available = !site.listing_removed && !site.pendingDrop && !site.suggested_drop &&
    !/seller availability/i.test(site.chargingHold ?? "") &&
    site.stage_group !== "dropped" && !/dropped|off[ -]?market/i.test(site.stage ?? "");
  const qualifies = available && purchaseRoutes.has(review.primary.route) && diligenceLayout(site.charging?.preliminary, true);
  if (!qualifies && review.primary.disposition !== "Shortlist") return review;
  return {...review, primary:{...review.primary, disposition:qualifies ? "Shortlist" : "Investigate", rank:null}};
}
