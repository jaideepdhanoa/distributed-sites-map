import { readGenerated } from "./guard";
import { snapshotGeneration } from "./snapshot/read";
import type { DealProps } from "./types";
import type { PricedSite } from "./pricing";

type PricingFile = {
  deals?: Record<string, PricedSite>;
};

let cached: { generation: number; file: PricingFile } | null = null;

function pricingFile(): PricingFile {
  const generation = snapshotGeneration();
  if (cached && cached.generation === generation) return cached.file;
  const file = readGenerated("pricing.json") as PricingFile;
  cached = { generation, file };
  return file;
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
  const next: DealProps = { ...props };
  const keep = new Set(["county_value", "county_value_basis", "land_value", "improvement_value"]);
  for (const [key, value] of Object.entries(extra)) {
    const current = (next as Record<string, unknown>)[key];
    if (keep.has(key) && current != null && current !== "") continue;
    (next as Record<string, unknown>)[key] = value;
  }
  if ((extra.stated_revenue != null || extra.stated_cash_flow != null) && next.kind !== "land" && next.figures_status !== "vacant") {
    next.figures_status = "shown";
  }
  return { ...feature, properties: next };
}
