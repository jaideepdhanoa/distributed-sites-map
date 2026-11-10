import { agentOk, requireInbox, withAgentDb } from "@/lib/agent/http";
import { ackInbox, FeedError } from "@/lib/agent/inbox";
import { isResponse, jsonError } from "@/lib/actions/http";

export async function POST(request: Request) {
  const denied = requireInbox(request);
  if (denied) return denied;
  let body: { ids?: unknown; status?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("The acknowledgement could not be read.", 400);
  }
  if (!Array.isArray(body.ids) || (body.status !== "picked" && body.status !== "done")) {
    return jsonError("Mark a row picked or done.", 400);
  }
  const ids = body.ids.filter((id): id is string => typeof id === "string");
  const result = await withAgentDb((sql) => ackInbox(sql, { ids, status: body.status as "picked" | "done" }));
  if (result instanceof FeedError) return jsonError(result.message, result.status);
  if (isResponse(result)) return result;
  return agentOk({ updated: result });
}
