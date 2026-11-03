import { NextResponse } from "next/server";
import { isSession, privateHeaders, readGenerated, requireUser } from "@/lib/guard";
import type { SiteFeature } from "@/lib/types";

export const dynamic = "force-dynamic";

const KEEP = [
  "site_id",
  "city",
  "name",
  "address",
  "apn",
  "coord_status",
  "site_class",
  "in_area",
  "service_ring",
  "expansion_horizon",
  "duplicate_of",
  "counts_as_site",
  "lot_ac",
  "owner",
  "tenure",
  "spare_ac_own",
  "spare_ac_adjoining",
  "verdict",
  "land_tier",
  "land_control",
  "network_status",
  "listed",
  "contacted",
  "asking_price_display",
  "asking_price_source",
  "pipeline_stage",
  "land_only",
  "utility_proximity",
  "aerial_fit",
  "verification",
  "elimination_reason",
  "tenure_fail",
  "is_held_fit",
  "tier_from_adjoining",
  "why_stopped",
  "is_candidate",
  "origin",
  "miles_to_depot",
  "linked_deal_id",
  "linked_deal_name",
  "linked_deal_stage",
  "parcel_match",
  "parcel_acres",
  "lot_ac_source",
  "listing_url",
  "evidence",
  "spare_ac_own_text",
  "spare_ac_adjoining_text",
  "muse_verdict",
  "verdict_disagreement",
  "scale_note",
] as const;

export async function GET() {
  const session = await requireUser();
  if (!isSession(session)) return session;
  const full = readGenerated("sites.geojson") as { features: SiteFeature[] };
  const features = full.features.map((feature) => {
    const properties: Record<string, unknown> = {};
    for (const key of KEEP) properties[key] = feature.properties[key];
    return { type: "Feature", geometry: feature.geometry, properties };
  });
  console.info(JSON.stringify({ event: "data", user: session.u, part: "sites" }));
  return NextResponse.json({ type: "FeatureCollection", features }, { headers: privateHeaders });
}
