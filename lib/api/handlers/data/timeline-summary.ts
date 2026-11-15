import { NextResponse } from "next/server";
import { isSession, privateHeaders, readGenerated, requireUser } from "@/lib/guard";
import { summaryRecords } from "@/lib/timeline/filter";

export async function GET() {
  const session = await requireUser();
  if (!isSession(session)) return session;
  let raw: unknown = { records: {} };
  try {
    raw = readGenerated("timeline.json");
  } catch {
    raw = { records: {} };
  }
  return NextResponse.json({ records: summaryRecords(raw) }, { headers: privateHeaders });
}
