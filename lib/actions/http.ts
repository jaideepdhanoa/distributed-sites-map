import { NextResponse } from "next/server";
import { isSession, privateHeaders, requireUser } from "@/lib/guard";
import { PolicyError } from "@/lib/policy/banned";
import type { SessionUser } from "@/lib/session";
import { audit } from "./audit";
import { actionsEnabled, withSql, type Sql } from "./db";
import { migrate, whenReady } from "./migrate";
import { roleAllows, type ActionRole } from "./roles";
import { InputError } from "./text";

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: privateHeaders });
}

export function jsonOk(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: privateHeaders });
}

export async function openActions(need: ActionRole): Promise<SessionUser | NextResponse> {
  if (!actionsEnabled()) return jsonError("Actions are off until a database is configured.", 503);
  const session = await requireUser();
  if (!isSession(session)) return session;
  if (!roleAllows(session.actionRole, need)) return jsonError("You do not have permission for that.", 403);
  try {
    await whenReady(() => withSql(async (sql) => {
      await migrate(sql);
    }));
  } catch {
    console.error(JSON.stringify({ event: "actions_db_error" }));
    return jsonError("The actions database is unavailable.", 503);
  }
  return session;
}

export async function runWrite<T>(
  session: SessionUser,
  meta: { action: string; targetKind?: string; targetId?: string },
  fn: (sql: Sql) => Promise<T>,
): Promise<T | NextResponse> {
  try {
    return await withSql(fn);
  } catch (error) {
    if (error instanceof PolicyError) {
      try {
        await withSql((sql) =>
          audit(sql, {
            actorId: session.u,
            action: `${meta.action}.blocked`,
            targetKind: meta.targetKind,
            targetId: meta.targetId,
            after: { result: "blocked" },
          }),
        );
      } catch {
        console.error(JSON.stringify({ event: "actions_audit_error" }));
      }
      return jsonError(error.message, 400);
    }
    if (error instanceof InputError) return jsonError(error.message, error.status);
    console.error(JSON.stringify({ event: "actions_error", name: error instanceof Error ? error.name : "error" }));
    return jsonError("The action could not be saved.", 500);
  }
}

export function isResponse<T>(value: T | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}
