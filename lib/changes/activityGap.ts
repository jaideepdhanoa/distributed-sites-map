import { isExcludedSite } from "@/lib/alerts/excluded";
import { siteTokens } from "@/lib/comms";
import { shortHash } from "./site";
import { SITE_ID } from "./vocab";

export type ActivityGapInput = {
  sites?: { site_id: string }[];
  activities: { site_id: string }[];
  comms: { site_id: string; site_ids?: string }[];
};

/** Sites with neither an activity row nor a comms row. Ids are hashed. The excluded site is omitted. */
export function activityGapHashes(slice: ActivityGapInput): string[] {
  const covered = new Set<string>();
  const add = (value: string) => {
    const id = value.trim().toUpperCase();
    if (id && !isExcludedSite(id)) covered.add(id);
  };
  for (const row of slice.activities) add(row.site_id);
  for (const row of slice.comms) {
    add(row.site_id);
    for (const token of siteTokens(row.site_ids || "")) add(token);
  }
  const hashes: string[] = [];
  const seen = new Set<string>();
  for (const row of slice.sites || []) {
    const id = row.site_id.trim().toUpperCase();
    if (!SITE_ID.test(id) || isExcludedSite(id) || covered.has(id) || seen.has(id)) continue;
    seen.add(id);
    hashes.push(shortHash(id));
  }
  hashes.sort();
  return hashes;
}

/** Counts and hashed ids only. */
export function formatActivityGaps(hashes: string[]): string {
  if (!hashes.length) return "";
  const lines = [`Activity gaps: ${hashes.length}. A site with no activity and no comms.`];
  for (const hash of hashes.slice(0, 20)) lines.push(`- #${hash}`);
  if (hashes.length > 20) lines.push(`- and ${hashes.length - 20} more`);
  return lines.join("\n");
}
