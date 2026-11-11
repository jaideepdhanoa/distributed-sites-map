import { readFileSync } from "node:fs";
import { dealInCategories, defaultCategories, type Categories } from "../lib/categories";

type DealProps = {
  city?: string;
  kind?: string;
  stage_group?: string;
  is_c_store?: boolean;
  business_type?: string;
  name?: string;
};

export type CityPipelineCounts = {
  deskDeals: number;
  deskLand: number;
  deskTotal: number;
  activeDeals: number;
  activeLand: number;
  droppedDeals: number;
  droppedLand: number;
};

/** Pipeline copy is counted from the committed deals, the same way the funnel does. */
export function cityPipelineCounts(city = "PHX", options: { cstore?: boolean; land?: boolean; auto?: boolean; wash?: boolean } = {}): CityPipelineCounts {
  const data = JSON.parse(readFileSync("data/generated/deals.geojson", "utf8")) as {
    features: { properties: DealProps }[];
  };
  const categories: Categories = { ...defaultCategories(), land: Boolean(options.land), store: Boolean(options.cstore) };
  if (options.auto !== undefined) categories.auto = options.auto;
  if (options.wash !== undefined) categories.wash = options.wash;
  const cityRows = data.features.map((feature) => feature.properties).filter((deal) => deal.city === city);
  const rows = cityRows.filter((deal) => dealInCategories(deal, categories));
  const count = (kind: string, group?: string, source = rows) =>
    source.filter((deal) => deal.kind === kind && (group == null || deal.stage_group === group)).length;
  const pipeline = count("pipeline");
  const land = count("land");
  const droppedDeals = count("pipeline", "dropped");
  const droppedLand = count("land", "dropped");
  const deskDeals = count("pipeline", "desk");
  const deskLand = count("land", "desk", cityRows);
  return {
    deskDeals,
    deskLand,
    deskTotal: deskDeals + (options.land ? deskLand : 0),
    activeDeals: pipeline - droppedDeals,
    activeLand: land - droppedLand,
    droppedDeals,
    droppedLand,
  };
}
