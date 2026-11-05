import { NextRequest, NextResponse } from "next/server";
import { isSession, privateHeaders, readGenerated, requireUser } from "@/lib/guard";
import type { SiteFeature } from "@/lib/types";

export const dynamic = "force-dynamic";

const KEEP = [
  "site_id",
  "city",
  "name",
  "also_known_as",
  "summary_why",
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
  "site_capacity",
  "land_control",
  "network_status",
  "listed",
  "contacted",
  "asking_price_display",
  "asking_price_source",
  "pipeline_stage",
  "land_only",
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
  "folder_url",
  "research_sources",
  "research_note",
  "business_type",
  "evidence",
  "spare_ac_own_text",
  "spare_ac_adjoining_text",
  "second_review_verdict",
  "verdict_disagreement",
  "scale_note",
  "zoning",
  "land_use",
  "lead_source",
  "zoning_source",
  "aadt_count",
  "aadt_road",
  "aadt_year",
  "aadt_source",
  "phone",
  "phone_source",
  "website",
  "website_source",
  "place_note",
  "place_note_source",
  "flood_zone",
  "county_url",
  "operating",
  "street_view_url",
  "owner_mail",
  "assessed_value_display",
  "full_cash_value_display",
  "last_sale_date",
  "last_sale_price_display",
  "year_built",
  "assessor_source",
] as const;

export async function GET(request: NextRequest) {
  const session = await requireUser();
  if (!isSession(session)) return session;
  const city = request.nextUrl.searchParams.get("city");
  const full = readGenerated("sites.geojson") as { features: SiteFeature[] };
  const chosen = city ? full.features.filter((feature) => feature.properties.city === city) : full.features;
  const features = chosen.map((feature) => {
    const properties: Record<string, unknown> = {};
    for (const key of KEEP) properties[key] = feature.properties[key];
    return { type: "Feature", geometry: feature.geometry, properties };
  });
  console.info(JSON.stringify({ event: "data", user: session.u, part: "sites" }));
  return NextResponse.json({ type: "FeatureCollection", features }, { headers: privateHeaders });
}
