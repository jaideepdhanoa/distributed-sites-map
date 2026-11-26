import { indexPowerLinks } from "@/lib/powerLinkIndex";
export { indexPowerLinks } from "@/lib/powerLinkIndex";
import { readGenerated, snapshotGeneration } from "@/lib/snapshot/read";
import type { TargetKind } from "./text";

type Target = { targetKind: TargetKind; targetId: string };
type Collection = { features: { properties: {deal_id: string; universe_id: string; site_id: string; linked_deal_id: string; linked_deal_ids?: string[]} }[] };

let cache: { generation: ReturnType<typeof snapshotGeneration>; links: ReturnType<typeof indexPowerLinks> } | undefined;
export function linkedPowerRecord(target: Target) {
  const generation = snapshotGeneration();
  if (!cache || cache.generation !== generation) {
    const deals = readGenerated("deals.geojson") as Collection;
    const sites = readGenerated("sites.geojson") as Collection;
    cache = { generation, links: indexPowerLinks([
      ...deals.features.map(({ properties: p }): [string, string] => [p.deal_id, p.universe_id]),
      ...sites.features.flatMap(({ properties: p }) => [p.linked_deal_id, ...(p.linked_deal_ids || [])].map((id): [string, string] => [id, p.site_id])),
    ]) };
  }
  return cache.links.get(target.targetKind + ":" + target.targetId);
}
