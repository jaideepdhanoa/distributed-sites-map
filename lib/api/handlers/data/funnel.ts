import { NextResponse } from "next/server";
import { isSession, privateHeaders, readGenerated, requireUser } from "@/lib/guard";
import { snapshotStatus } from "@/lib/snapshot/read";

export async function GET() {
  const session = await requireUser();
  if (!isSession(session)) return session;
  const report = readGenerated("build_report.json") as {
    generated_at?: string;
    warnings?: unknown;
    parcels?: { note?: string };
    land_tiers?: unknown;
    changes?: unknown;
  };
  const snapshot = snapshotStatus();
  return NextResponse.json(
    {
      funnel: readGenerated("funnel.json"),
      meta: {
        generated_at: report.generated_at,
        warnings: report.warnings,
        parcel_note: report.parcels?.note,
        land_tiers: report.land_tiers,
        changes: report.changes,
        snapshot_id: snapshot.snapshot_id,
        snapshot_created_at: snapshot.snapshot_created_at,
      },
    },
    { headers: privateHeaders },
  );
}
