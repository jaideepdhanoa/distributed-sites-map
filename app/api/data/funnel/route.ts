import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { isSession, privateHeaders, readGenerated, requireUser } from "@/lib/guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireUser();
  if (!isSession(session)) return session;
  const report = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "generated", "build_report.json"), "utf8"));
  return NextResponse.json(
    {
      funnel: readGenerated("funnel.json"),
      meta: {
        generated_at: report.generated_at,
        warnings: report.warnings,
        parcel_note: report.parcels?.note,
        land_tiers: report.land_tiers,
      },
    },
    { headers: privateHeaders },
  );
}
