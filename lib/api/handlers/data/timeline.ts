import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { actionsEnabled, withSql } from "@/lib/actions/db";
import { isSession, privateHeaders, requireUser } from "@/lib/guard";
import { listRecordedHistory } from "@/lib/queue/events";
import { suggestedDropHistory } from "@/lib/suggestedDrop";
import { presentCard, showActivityLines, type TimelineItem } from "@/lib/timeline/filter";
import { mergeBringBackHistory } from "@/lib/timeline/history";

function readTimeline(): unknown {
  const path = join(process.cwd(), "data", "generated", "timeline.json");
  if (!existsSync(path)) return { records: {}, items: [] };
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { records: {}, items: [] };
  }
}

export async function GET(request: Request) {
  const session = await requireUser();
  if (!isSession(session)) return session;
  const url = new URL(request.url);
  const ids = [url.searchParams.get("id") || "", url.searchParams.get("related") || ""];
  const card = presentCard(readTimeline(), ids);
  const items = await activityItems(card.items, ids);
  return NextResponse.json({ ...card, items, showActivityLines: showActivityLines() }, { headers: privateHeaders });
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
