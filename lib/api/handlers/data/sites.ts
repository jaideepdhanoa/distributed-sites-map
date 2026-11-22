import { NextRequest, NextResponse } from "next/server";
import { isSession, readGenerated, requireUser, snapshotCacheHeaders } from "@/lib/guard";
import { currentSnapshotMeta, snapshotGeneration } from "@/lib/snapshot/read";
import { overlayHeldStages } from "@/lib/changes/heldStage";
import { overlayQuickLubeCensus } from "@/lib/changes/read";
import { overlayStageFile } from "@/lib/stageOverlayLoad";
import { omitProtectedSites } from "@/lib/protectedSite";
import type { SiteFeature } from "@/lib/types";
import { redactGmailPayload } from "@/lib/displayText";

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
  "service_area_class",
  "service_area_distance_mi",
  "service_area_polygon",
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
  "cap_a_substation_mi",
  "cap_a_line_ft",
  "cap_a_source",
  "cap_a_as_of",
  "cap_a_confidence",
  "cap_b_feeder",
  "cap_b_frontage",
  "cap_b_nearby",
  "cap_b_horizon",
  "cap_b_source",
  "cap_b_as_of",
  "cap_b_confidence",
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
  "linked_deal_ids",
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
  "brand_type",
  "brand_note",
  "bay_count",
  "lift_count",
  "lot_sqft",
  "outside_sqft",
  "outside_note",
  "owner_of_record",
  "owner_verdict",
  "listing_source",
  "listing_status",
  "source_tag",
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
  "photos",
  "photo_status",
  "photo_diligence_count",
  "photo_listing_count",
  "photos_checked",
  "photo_notes",
  "stage_pending",
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
  const visible = omitProtectedSites(full.features);
  const chosen = city ? visible.filter((feature) => feature.properties.city === city) : visible;
  const features = chosen.map((feature) => {
    const properties: Record<string, unknown> = {};
    for (const key of KEEP) properties[key] = feature.properties[key];
    return { type: "Feature" as const, geometry: feature.geometry, properties: properties as SiteFeature["properties"] };
  });
  const withCensus = await overlayQuickLubeCensus({ type: "FeatureCollection", features });
  const staged = await overlayHeldStages(await overlayStageFile(withCensus, "site"), "site");
  console.info(JSON.stringify({ event: "data", user: session.u, part: "sites" }));
  const version = currentSnapshotMeta()?.id || `files-${snapshotGeneration()}`;
  return NextResponse.json(redactGmailPayload(staged), { headers: snapshotCacheHeaders(version) });
}
