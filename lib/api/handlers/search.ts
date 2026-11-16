import { jsonError } from "@/lib/actions/http";
import { actionsEnabled, withSql } from "@/lib/actions/db";
import { isSession, privateHeaders, requireUser } from "@/lib/guard";
import { NextResponse } from "next/server";
import { visibilityFor } from "@/lib/search/access";
import { embedText } from "@/lib/search/embed";
import { gridIds, groupHits, searchDocs, searchReady } from "@/lib/search/query";
import { searchSnapshot } from "@/lib/search/snapshot";
import type { PaletteGroups } from "@/lib/search/palette";

function empty() {
  return { sites: [], brokers: [], conversations: [] };
}

function fillGroups(primary: PaletteGroups, extra: PaletteGroups): PaletteGroups {
  return {
    sites: primary.sites.length ? primary.sites : extra.sites,
    brokers: primary.brokers.length ? primary.brokers : extra.brokers,
    conversations: primary.conversations.length ? primary.conversations : extra.conversations,
  };
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
  const recorded = searchSnapshot(q);
  if (!actionsEnabled()) {
    return NextResponse.json({ mode: "records", groups: recorded, ids: recorded.sites.map((item) => item.id) }, { headers: privateHeaders });
  }
  try {
    const body = await withSql(async (sql) => {
      if (!(await searchReady(sql))) return { mode: "records" as const, groups: recorded, ids: recorded.sites.map((item) => item.id) };
      const embedding = scope === "grid" ? null : await embedText(q);
      const hits = await searchDocs(sql, {
        query: q,
        visibility: visibilityFor({ id: session.u, kind: "human" }),
        types: scope === "grid" ? ["site", "broker", "comms", "note"] : undefined,
        embedding,
      });
      return { mode: "index" as const, groups: fillGroups(groupHits(hits), recorded), ids: gridIds(hits) };
    });
    return NextResponse.json(body, { headers: privateHeaders });
  } catch (error) {
    console.error(JSON.stringify({ event: "search_error", name: error instanceof Error ? error.name : "error" }));
    return jsonError("Search is unavailable.", 500);
  }
}
