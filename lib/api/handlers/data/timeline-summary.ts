import { NextResponse } from "next/server";
import { actionsEnabled, withSql } from "@/lib/actions/db";
import { latestTouch } from "@/lib/counts";
import { isSession, privateHeaders, readGenerated, requireUser } from "@/lib/guard";
import { listAppEvents } from "@/lib/queue/events";
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
  const records = summaryRecords(raw);
  if (actionsEnabled()) {
    try {
      const events = await withSql((sql) => listAppEvents(sql));
      for (const event of events) {
        const current = records[event.siteId];
        const lastTouched = latestTouch(current?.lastTouched || "", [event.at]);
        if (!lastTouched) continue;
        records[event.siteId] = { lastTouched, materials: current?.materials || 0 };
      }
    } catch {
      console.error(JSON.stringify({ event: "timeline_summary_events_error" }));
    }
  }
  return NextResponse.json({ records }, { headers: privateHeaders });
}
