import { NextResponse } from "next/server";
import { actionsEnabled, withSql } from "@/lib/actions/db";
import { isExcludedSite } from "@/lib/alerts/excluded";
import { isSession, privateHeaders, requireUser } from "@/lib/guard";
import { listSiteSpaces } from "@/lib/spaces/store";
import { spaceSiteAllowed } from "@/lib/spaces/vocab";

function missingRelation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "42P01");
}

/** Signed-in read of marked spaces. An unmigrated database returns an empty list. */
export async function GET(request: Request) {
  const session = await requireUser();
  if (!isSession(session)) return session;
  const siteId = new URL(request.url).searchParams.get("site")?.trim() || "";
  if (!spaceSiteAllowed(siteId) || isExcludedSite(siteId)) {
    return NextResponse.json({ spaces: [] }, { headers: privateHeaders });
  }
  if (!actionsEnabled()) return NextResponse.json({ spaces: [] }, { headers: privateHeaders });
  try {
    const spaces = await withSql((sql) => listSiteSpaces(sql, siteId));
    return NextResponse.json({ spaces }, { headers: privateHeaders });
  } catch (error) {
    if (missingRelation(error)) return NextResponse.json({ spaces: [] }, { headers: privateHeaders });
    console.error(JSON.stringify({ event: "spaces_read_error", name: error instanceof Error ? error.name : "error" }));
    return NextResponse.json({ error: "Marked spaces could not be loaded." }, { status: 503, headers: privateHeaders });
  }
}
