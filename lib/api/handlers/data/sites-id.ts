import { NextResponse } from "next/server";
import { isSession, privateHeaders, readGenerated, requireUser } from "@/lib/guard";
import { overlayHeldStages } from "@/lib/changes/heldStage";
import { overlayQuickLubeCensus } from "@/lib/changes/read";
import { overlayStageFile } from "@/lib/stageOverlayLoad";
import { isProtectedId } from "@/lib/protectedSite";
import type { SiteFeature } from "@/lib/types";
import { redactGmailPayload } from "@/lib/displayText";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireUser();
  if (!isSession(session)) return session;
  const { id } = await context.params;
  if (isProtectedId(id)) return NextResponse.json({ error: "Not found" }, { status: 404, headers: privateHeaders });
  const full = await overlayQuickLubeCensus(readGenerated("sites.geojson") as { features: SiteFeature[] });
  const feature = (full.features || []).find((item) => item.properties.site_id === id);
  if (feature && (isProtectedId(feature.properties.linked_deal_id) || feature.properties.linked_deal_ids?.some((item) => isProtectedId(item)))) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: privateHeaders });
  }
  if (!feature) return NextResponse.json({ error: "Not found" }, { status: 404, headers: privateHeaders });
  const properties = { ...feature.properties } as Record<string, unknown>;
  delete properties.utility_proximity;
  delete properties.serving_utility;
  delete properties.serving_utility_source;
  delete properties.site_capacity;
  const staged = await overlayHeldStages(await overlayStageFile({ features: [{ properties }] }, "site"), "site");
  console.info(JSON.stringify({ event: "data", user: session.u, part: "site", id }));
  return NextResponse.json(redactGmailPayload(staged.features?.[0]?.properties || properties), { headers: privateHeaders });
}
