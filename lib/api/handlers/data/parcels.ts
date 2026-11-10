import { NextResponse } from "next/server";
import { isSession, privateHeaders, readGenerated, requireUser } from "@/lib/guard";

export async function GET(request: Request) {
  const session = await requireUser();
  if (!isSession(session)) return session;
  const city = new URL(request.url).searchParams.get("city");
  const name = city === "PHX" || city === "LAS" || city === "MIA" ? `parcels-${city}.geojson` : "parcels.geojson";
  console.info(JSON.stringify({ event: "data", user: session.u, part: "parcels", city }));
  return NextResponse.json(readGenerated(name), { headers: privateHeaders });
}
