import { NextResponse } from "next/server";
import { audit } from "@/lib/actions/audit";
import { withSql } from "@/lib/actions/db";
import { privateHeaders } from "@/lib/guard";
import { isResponse, jsonError, openActions } from "@/lib/actions/http";
import { listSuggestions, reconcileSuggestions, suggestionsCsv } from "@/lib/actions/suggestions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await openActions("viewer");
  if (isResponse(session)) return session;
  try {
    const csv = await withSql(async (sql) => {
      await reconcileSuggestions(sql);
      const rows = await listSuggestions(sql);
      await audit(sql, { actorId: session.u, action: "export", after: { kind: "suggestions", count: rows.length } });
      return suggestionsCsv(rows);
    });
    return new NextResponse(csv, {
      headers: {
        ...privateHeaders,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=\"suggestions.csv\"",
      },
    });
  } catch {
    return jsonError("The suggestions could not be exported.", 500);
  }
}
