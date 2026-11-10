import { NextResponse } from "next/server";
import { authorizeInbox } from "@/lib/agent/auth";
import { FeedError } from "@/lib/agent/inbox";
import { actionsEnabled, withSql, type Sql } from "@/lib/actions/db";
import { jsonError, jsonOk } from "@/lib/actions/http";
import { migrate, whenReady } from "@/lib/actions/migrate";
import { privateHeaders } from "@/lib/guard";
import { PolicyError } from "@/lib/policy/banned";

export function agentUnauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
}

export function requireInbox(request: Request): NextResponse | null {
  if (!authorizeInbox(request)) return agentUnauthorized();
  return null;
}

export async function withAgentDb<T>(fn: (sql: Sql) => Promise<T>): Promise<T | NextResponse> {
  if (!actionsEnabled()) return jsonError("The agent feed needs a database.", 503);
  try {
    await whenReady(() => withSql(async (sql) => {
      await migrate(sql);
    }));
  } catch {
    return jsonError("The actions database is unavailable.", 503);
  }
  try {
    return await withSql(fn);
  } catch (error) {
    if (error instanceof PolicyError) return jsonError(error.message, 400);
    if (error instanceof FeedError) return jsonError(error.message, error.status);
    console.error(JSON.stringify({ event: "agent_feed_error", name: error instanceof Error ? error.name : "error" }));
    return jsonError("The agent feed could not be read.", 500);
  }
}

export function agentOk(body: unknown, status = 200) {
  return jsonOk(body, status);
}
