import { readFileSync } from "node:fs";
import path from "node:path";
import type { DealProps } from "./types";
import type { PricedSite } from "./pricing";

type PricingFile = {
  deals?: Record<string, PricedSite>;
};

let cached: PricingFile | null = null;

function pricingFile(): PricingFile {
  if (cached) return cached;
  const file = path.join(process.cwd(), "data", "generated", "pricing.json");
  cached = JSON.parse(readFileSync(file, "utf8")) as PricingFile;
  return cached;
}

/** Workbook pricing for one deal. Package file names are not in this file. */
export function pricingFor(dealId: string): PricedSite | null {
  return pricingFile().deals?.[dealId] || null;
}

export function withPricing<T extends { properties?: object | null }>(feature: T): T {
  const props = feature.properties as DealProps | null | undefined;
  if (!props?.deal_id) return feature;
  const extra = pricingFor(props.deal_id);
  if (!extra) return feature;
  const next: DealProps = { ...props, ...extra };
  if ((extra.stated_revenue != null || extra.stated_cash_flow != null) && next.kind !== "land" && next.figures_status !== "vacant") {
    next.figures_status = "shown";
  }
  return { ...feature, properties: next };
}
