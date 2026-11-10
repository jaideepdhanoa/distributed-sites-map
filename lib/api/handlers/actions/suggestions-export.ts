import { NextResponse } from "next/server";
import { audit } from "@/lib/actions/audit";
import { withSql } from "@/lib/actions/db";
import { privateHeaders } from "@/lib/guard";
import { isResponse, jsonError, openActions } from "@/lib/actions/http";
import { listSuggestions, nextStepsCsv, reconcileSuggestions, suggestionsCsv } from "@/lib/actions/suggestions";

export async function GET(request: Request) {
  const session = await openActions("viewer");
  if (isResponse(session)) return session;
  const nextSteps = new URL(request.url).searchParams.get("kind") === "next";
  try {
    const csv = await withSql(async (sql) => {
      await reconcileSuggestions(sql);
      const rows = await listSuggestions(sql);
      await audit(sql, { actorId: session.u, action: "export", after: { kind: nextSteps ? "next-steps" : "suggestions", count: rows.length } });
      return nextSteps ? nextStepsCsv(rows) : suggestionsCsv(rows);
    });
    return new NextResponse(csv, {
      headers: {
        ...privateHeaders,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${nextSteps ? "next-steps.csv" : "suggestions.csv"}"`,
      },
    });
  } catch {
    return jsonError("The suggestions could not be exported.", 500);
  }
}
