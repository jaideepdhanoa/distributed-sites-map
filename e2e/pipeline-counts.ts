import { readFileSync } from "node:fs";

type DealProps = {
  city?: string;
  kind?: string;
  stage_group?: string;
  is_c_store?: boolean;
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
export function cityPipelineCounts(city = "PHX"): CityPipelineCounts {
  const data = JSON.parse(readFileSync("data/generated/deals.geojson", "utf8")) as {
    features: { properties: DealProps }[];
  };
  const rows = data.features.map((feature) => feature.properties).filter((deal) => deal.city === city && !deal.is_c_store);
  const count = (kind: string, group?: string) =>
    rows.filter((deal) => deal.kind === kind && (group == null || deal.stage_group === group)).length;
  const pipeline = count("pipeline");
  const land = count("land");
  const droppedDeals = count("pipeline", "dropped");
  const droppedLand = count("land", "dropped");
  const deskDeals = count("pipeline", "desk");
  const deskLand = count("land", "desk");
  return {
    deskDeals,
    deskLand,
    deskTotal: deskDeals + deskLand,
    activeDeals: pipeline - droppedDeals,
    activeLand: land - droppedLand,
    droppedDeals,
    droppedLand,
  };
}
