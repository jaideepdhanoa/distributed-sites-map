import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { isSession, privateHeaders, requireUser } from "@/lib/guard";
import { presentCard, showActivityLines } from "@/lib/timeline/filter";

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
  return NextResponse.json({ ...card, showActivityLines: showActivityLines() }, { headers: privateHeaders });
}
