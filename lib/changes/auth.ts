import { agentFromAuthorization } from "@/lib/agent/auth";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/actions/http";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import type { Actor } from "./schema";

export { agentFromAuthorization };

function cookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const raw = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

export function isActor(value: Actor | NextResponse): value is Actor {
  return !(value instanceof NextResponse);
}

/** A bearer token selects the agent. Otherwise the signed-in session is the human actor. */
export async function actorFromRequest(request: Request): Promise<Actor | NextResponse> {
  const header = request.headers.get("authorization");
  if (header && header.trim()) {
    const matched = agentFromAuthorization(header);
    if (matched === "missing-env") {
      return jsonError("Agent writes are off until AGENT_WRITE_TOKEN_INDIE, AGENT_WRITE_TOKEN_MUSE or AGENT_WRITE_TOKEN_CHATGPT is set.", 401);
    }
    if (matched === "nomatch" || matched === "absent") return jsonError("Unauthorized", 401);
    return matched;
  }
  const session = await readSession(cookieValue(request, SESSION_COOKIE));
  if (!session) return jsonError("Unauthorized", 401);
  return { id: session.u, kind: "human", role: session.actionRole };
}
