import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { isSession, privateHeaders, requireUser } from "@/lib/guard";
import { presentTimeline } from "@/lib/timeline/filter";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireUser();
  if (!isSession(session)) return session;
  const url = new URL(request.url);
  const ids = [url.searchParams.get("id") || "", url.searchParams.get("related") || ""];
  const path = join(process.cwd(), "data", "generated", "timeline.json");
  let raw: unknown = { items: [] };
  if (existsSync(path)) {
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      raw = { items: [] };
    }
  }
  return NextResponse.json({ items: presentTimeline(raw, ids) }, { headers: privateHeaders });
}
