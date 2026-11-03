import { cookies } from "next/headers";
import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { readSession, SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

const HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
};

export async function GET() {
  const jar = await cookies();
  const session = await readSession(jar.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: HEADERS });
  const dir = path.join(process.cwd(), "data", "generated");
  const read = (name: string) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
  const report = read("build_report.json");
  console.info(JSON.stringify({ event: "data", user: session.u }));
  return NextResponse.json(
    {
      sites: read("sites.geojson"),
      areas: read("areas.geojson"),
      depots: read("depots.geojson"),
      parcels: read("parcels.geojson"),
      funnel: read("funnel.json"),
      meta: {
        generated_at: report.generated_at,
        warnings: report.warnings,
        parcel_note: report.parcels?.note,
        land_tiers: report.land_tiers,
      },
    },
    { headers: HEADERS },
  );
}
