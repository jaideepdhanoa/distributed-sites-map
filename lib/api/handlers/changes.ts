import { NextResponse } from "next/server";
import { jsonError, jsonOk } from "@/lib/actions/http";
import { actionsEnabled, withSql } from "@/lib/actions/db";
import { migrate } from "@/lib/actions/migrate";
import { InputError } from "@/lib/actions/text";
import { privateHeaders } from "@/lib/guard";
import { PolicyError } from "@/lib/policy/banned";
import { notifyAppliedChanges } from "@/lib/alerts/agentWrite";
import { actorFromRequest, isActor } from "@/lib/changes/auth";
import { applyBatch, IdempotencyConflictError, VersionConflictError } from "@/lib/changes/apply";
import { cookieWriteAllowed } from "@/lib/changes/csrf";
import { changesApiEnabled } from "@/lib/changes/flags";
import { assertEventsWritable, ProductionWriteRefused } from "@/lib/changes/guard";
import { previewDatabaseWriteResponse } from "@/lib/preview/block";

function pgCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  return String((error as { code?: unknown }).code || "");
}

/** Shadow write path. Production stays off until CHANGES_API_ENABLED is set. */
export async function POST(request: Request) {
  const blocked = previewDatabaseWriteResponse();
  if (blocked) return blocked;
  const bearer = request.headers.get("authorization")?.trim();
  const cookie = request.headers.get("cookie")?.trim();
  if (!bearer && cookie && !cookieWriteAllowed(request)) return jsonError("That request was refused.", 403);
  const actor = await actorFromRequest(request);
  if (!isActor(actor)) return actor;
  if (!changesApiEnabled()) return jsonError("Changes are off until CHANGES_API_ENABLED is set.", 403);
  if (!actionsEnabled()) return jsonError("Changes are off until a database is configured.", 503);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("That request is not valid JSON.", 400);
  }
  try {
    assertEventsWritable();
    // Apply pending files on this database. Production skips. A preview
    // pointed at production is refused above. A safe preview database gets
    // the comment columns before the insert.
    await withSql(async (sql) => {
      await migrate(sql);
    });
    const result = await withSql(async (sql) => {
      const applied = await applyBatch(sql, actor, request.headers.get("idempotency-key") || "", body);
      if (!applied.replayed) {
        try {
          await notifyAppliedChanges(sql, actor, applied.results);
        } catch (error) {
          console.error(JSON.stringify({ event: "agent_alert_error", name: error instanceof Error ? error.name : "error" }));
        }
      }
      return applied;
    });
    return jsonOk(result);
  } catch (error) {
    if (error instanceof VersionConflictError || error instanceof IdempotencyConflictError) {
      const conflicts = error instanceof VersionConflictError ? error.conflicts : undefined;
      return NextResponse.json(
        conflicts ? { error: error.message, conflicts } : { error: error.message },
        { status: 409, headers: privateHeaders },
      );
    }
    if (error instanceof PolicyError) return jsonError(error.message, 400);
    if (error instanceof InputError) {
      return NextResponse.json(
        error.field ? { error: error.message, field: error.field } : { error: error.message },
        { status: error.status, headers: privateHeaders },
      );
    }
    if (error instanceof ProductionWriteRefused) return jsonError(error.message, 403);
    const code = pgCode(error);
    if (code === "42P01" || code === "42703") {
      return jsonError(
        "The database is missing a pending migration. Preview applies it on a non-production database. Production migrations run from the Production migrations workflow.",
        503,
      );
    }
    console.error(JSON.stringify({ event: "changes_error", name: error instanceof Error ? error.name : "error", code }));
    return jsonError("The change could not be saved.", 500);
  }
}
