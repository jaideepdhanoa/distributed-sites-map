import type { DealProps } from "@/lib/types";

/** Identifiers persist in the finding's source even if a display label changes. */
export const evidenceMeasures = {
  statement_revenue: "Statement revenue", statement_sde: "Statement SDE", statement_ebitda: "Statement EBITDA",
  on_site_service: "On-site service", frontage_hosting: "Street-frontage hosting",
  business_price: "Implied business price", business_multiple: "Business-only multiple",
  asking_multiple: "Asking / earnings", hub_savings: "Savings versus hub",
  open_land: "Open land", bays: "Bays that fit", power: "Power", zoning: "Zoning",
  asking: "Asking", revenue: "Revenue", ebitda: "EBITDA", cash_flow: "Cash flow",
  land_estimate: "Land estimate", reporting_period: "Reporting period",
  figure_basis: "Figure basis", financial_source: "Financial source",
  traffic: "Traffic", land: "Land", property_owner: "Property owner",
} as const;
export type EvidenceMeasure = keyof typeof evidenceMeasures;
export type EvidenceTarget = {
  targetKind: "deal" | "site"; targetId: string; measure: EvidenceMeasure; period: string; basis: string;
};
export type EvidenceRequest = { targetId?: string; targetKind?: "site" | "deal"; note: string; status: string; owner: string; due: string; closedAt?: string };
export function evidenceTarget(targetKind: "deal" | "site", targetId: string, label: string, deal?: DealProps): EvidenceTarget | undefined {
  const measure = (Object.keys(evidenceMeasures) as EvidenceMeasure[]).find(key => evidenceMeasures[key] === label);
  if (!measure) return;
  const revenue = measure === "revenue";
  const earnings = ["cash_flow", "ebitda", "business_multiple", "asking_multiple"].includes(measure);
  return { targetKind, targetId, measure,
    period: (revenue ? deal?.revenue_period : earnings ? deal?.earnings_period : "")?.trim() || "",
    basis: (revenue ? deal?.revenue_basis : earnings ? [measure === "cash_flow" && deal?.cash_flow_label, deal?.earnings_basis].filter(Boolean).join(" · ") : "")?.trim() || "",
  };
}
