import { NextResponse } from "next/server";
import { isSession, privateHeaders, readGenerated, requireUser } from "@/lib/guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireUser();
  if (!isSession(session)) return session;
  console.info(JSON.stringify({ event: "data", user: session.u, part: "deals" }));
  return NextResponse.json(readGenerated("deals.geojson"), { headers: privateHeaders });
}
