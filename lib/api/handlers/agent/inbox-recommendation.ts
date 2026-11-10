import { agentOk, requireInbox, withAgentDb } from "@/lib/agent/http";
import { addRecommendation, parseRecommendation } from "@/lib/agent/recommend";
import { isResponse, jsonError } from "@/lib/actions/http";
import { FeedError } from "@/lib/agent/inbox";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = requireInbox(request);
  if (denied) return denied;
  const { id } = await context.params;
  if (!/^[A-Za-z0-9-]{8,80}$/.test(id)) return jsonError("That inbox row is not in the feed.", 404);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("The recommendation could not be read.", 400);
  }
  let draft;
  try {
    draft = parseRecommendation(body);
  } catch (error) {
    if (error instanceof FeedError) return jsonError(error.message, error.status);
    const message = error instanceof Error ? error.message : "The recommendation could not be read.";
    return jsonError(message, 400);
  }
  const result = await withAgentDb((sql) => addRecommendation(sql, id, draft));
  if (isResponse(result)) return result;
  return agentOk({ id: result }, 201);
}
