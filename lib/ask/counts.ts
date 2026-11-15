import { readDeals } from "@/lib/changes/read";
import { readGenerated } from "@/lib/guard";

const MARKETS = [
  { city: "PHX", name: "Phoenix" },
  { city: "LAS", name: "Las Vegas" },
  { city: "MIA", name: "Miami" },
] as const;

export type ListedMarket = { city: string; name: string; listed: number };

/** Listed deals in the three markets whose stage is not dropped. */
export async function listedDealsByMarket(): Promise<ListedMarket[]> {
  let features: { properties?: Record<string, unknown> }[] = [];
  try {
    const file = await readDeals();
    features = file.features || [];
  } catch {
    features = [];
  }
  return MARKETS.map((market) => ({
    city: market.city,
    name: market.name,
    listed: features.filter((feature) => {
      const row = feature.properties || {};
      return row.city === market.city && row.listed === true && row.stage_group !== "dropped";
    }).length,
  }));
}

export async function listedCountLine(): Promise<string> {
  const rows = await listedDealsByMarket();
  return `Listed deals still in play, not dropped: ${rows.map((row) => `${row.name} ${row.listed}`).join(". ")}.`;
}
