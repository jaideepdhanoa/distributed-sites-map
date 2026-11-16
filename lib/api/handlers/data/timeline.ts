import { NextResponse } from "next/server";
import { actionsEnabled, withSql } from "@/lib/actions/db";
import { isSession, privateHeaders, readGenerated, requireUser } from "@/lib/guard";
import { listRecordedHistory } from "@/lib/queue/events";
import { suggestedDropHistory } from "@/lib/suggestedDrop";
import { overlayTimeline } from "@/lib/changes/read";
import { presentCard, showActivityLines, type TimelineItem } from "@/lib/timeline/filter";
import { redactGmailPayload } from "@/lib/displayText";
import { mergeBringBackHistory } from "@/lib/timeline/history";

async function readTimeline(ids: string[]): Promise<unknown> {
  try {
    return overlayTimeline(readGenerated("timeline.json"), ids);
  } catch {
    return { records: {}, items: [] };
  }
}

export async function GET(request: Request) {
  const session = await requireUser();
  if (!isSession(session)) return session;
  const url = new URL(request.url);
  const ids = [url.searchParams.get("id") || "", url.searchParams.get("related") || ""];
  const card = presentCard(await readTimeline(ids), ids);
  const items = await activityItems(card.items, ids);
  return NextResponse.json(redactGmailPayload({ ...card, items, showActivityLines: showActivityLines() }), { headers: privateHeaders });
}

async function activityItems(items: TimelineItem[], ids: string[]): Promise<TimelineItem[]> {
  const suggested = suggestedDropHistory(ids);
  if (!actionsEnabled()) return mergeBringBackHistory(items, suggested);
  try {
    const history = await withSql((sql) => listRecordedHistory(sql, ids));
    return mergeBringBackHistory(items, [...history, ...suggested]);
  } catch {
    console.error(JSON.stringify({ event: "timeline_history_error" }));
    return mergeBringBackHistory(items, suggested);
  }
}
