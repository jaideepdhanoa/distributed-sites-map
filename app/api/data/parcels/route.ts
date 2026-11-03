import { NextResponse } from "next/server";
import { isSession, privateHeaders, readGenerated, requireUser } from "@/lib/guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireUser();
  if (!isSession(session)) return session;
  return NextResponse.json(readGenerated("parcels.geojson"), { headers: privateHeaders });
}
