import { readFileSync } from "node:fs";
import { isPipelineStore } from "../lib/labels";

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

/** Phoenix pipeline copy is counted from the committed deals, the same way the funnel does. */
export function cityPipelineCounts(city = "PHX", options: { cstore?: boolean; land?: boolean } = {}): CityPipelineCounts {
  const data = JSON.parse(readFileSync("data/generated/deals.geojson", "utf8")) as {
    features: { properties: DealProps }[];
  };
  const cityRows = data.features.map((feature) => feature.properties).filter((deal) => deal.city === city);
  const rows = cityRows.filter((deal) => (options.cstore || !(deal.is_c_store || isPipelineStore(deal))) && (options.land || deal.kind !== "land"));
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
