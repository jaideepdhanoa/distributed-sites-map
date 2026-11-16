import { jsonError } from "@/lib/actions/http";
import { actionsEnabled, withSql } from "@/lib/actions/db";
import { isSession, privateHeaders, requireUser } from "@/lib/guard";
import { NextResponse } from "next/server";
import { visibilityFor } from "@/lib/search/access";
import { embedText } from "@/lib/search/embed";
import { gridIds, groupHits, searchDocs, searchReady } from "@/lib/search/query";

function empty() {
  return { sites: [], brokers: [], conversations: [] };
}

export async function GET(request: Request) {
  const session = await requireUser();
  if (!isSession(session)) return session;
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const scope = url.searchParams.get("scope") || "";
  if (q.length < 2) {
    return NextResponse.json({ mode: "fallback", groups: empty(), ids: [] }, { headers: privateHeaders });
  }
  if (!actionsEnabled()) {
    return NextResponse.json({ mode: "fallback", groups: empty(), ids: [] }, { headers: privateHeaders });
  }
  try {
    const body = await withSql(async (sql) => {
      if (!(await searchReady(sql))) return { mode: "fallback" as const, groups: empty(), ids: [] as string[] };
      const embedding = scope === "grid" ? null : await embedText(q);
      const hits = await searchDocs(sql, {
        query: q,
        visibility: visibilityFor({ id: session.u, kind: "human" }),
        types: scope === "grid" ? ["site", "broker", "comms", "note"] : undefined,
        embedding,
      });
      return { mode: "index" as const, groups: groupHits(hits), ids: gridIds(hits) };
    });
    return NextResponse.json(body, { headers: privateHeaders });
  } catch (error) {
    console.error(JSON.stringify({ event: "search_error", name: error instanceof Error ? error.name : "error" }));
    return jsonError("Search is unavailable.", 500);
  }
}
