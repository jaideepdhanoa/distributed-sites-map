import { requireInbox, agentOk, withAgentDb } from "@/lib/agent/http";
import { listInbox, toFeedItem } from "@/lib/agent/inbox";
import { feedOrigin } from "@/lib/agent/links";
import { isResponse } from "@/lib/actions/http";

export async function GET(request: Request) {
  const denied = requireInbox(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const after = url.searchParams.get("after");
  const limitRaw = Number(url.searchParams.get("limit") || "");
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? limitRaw : 50;
  const result = await withAgentDb((sql) => listInbox(sql, { after, limit }));
  if (isResponse(result)) return result;
  const origin = feedOrigin(request);
  return agentOk({ items: result.items.map((item) => toFeedItem(item, origin)), next: result.next });
}
