import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { isSession, privateHeaders, requireUser } from "@/lib/guard";
import { summaryRecords } from "@/lib/timeline/filter";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireUser();
  if (!isSession(session)) return session;
  const path = join(process.cwd(), "data", "generated", "timeline.json");
  let raw: unknown = { records: {} };
  if (existsSync(path)) {
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      raw = { records: {} };
    }
  }
  return NextResponse.json({ records: summaryRecords(raw) }, { headers: privateHeaders });
}
