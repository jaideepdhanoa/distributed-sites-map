import { NextResponse } from "next/server";
import { isSession, privateHeaders, readGenerated, requireUser } from "@/lib/guard";
import type { SiteFeature } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireUser();
  if (!isSession(session)) return session;
  const { id } = await context.params;
  const full = readGenerated("sites.geojson") as { features: SiteFeature[] };
  const feature = full.features.find((item) => item.properties.site_id === id);
  if (!feature) return NextResponse.json({ error: "Not found" }, { status: 404, headers: privateHeaders });
  const properties = { ...feature.properties } as Record<string, unknown>;
  delete properties.utility_proximity;
  delete properties.serving_utility;
  delete properties.serving_utility_source;
  delete properties.site_capacity;
  console.info(JSON.stringify({ event: "data", user: session.u, part: "site", id }));
  return NextResponse.json(properties, { headers: privateHeaders });
}
