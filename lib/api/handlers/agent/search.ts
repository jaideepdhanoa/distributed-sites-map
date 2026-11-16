import { agentOk, isAgentCaller, requireAgent, withAgentDb } from "@/lib/agent/http";
import { isResponse } from "@/lib/actions/http";
import { visibilityFor } from "@/lib/search/access";
import { embedText } from "@/lib/search/embed";
import { searchDocs } from "@/lib/search/query";

export async function GET(request: Request) {
  const caller = requireAgent(request);
  if (!isAgentCaller(caller)) return caller;
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const types = (url.searchParams.get("types") || "").split(",").map((item) => item.trim()).filter(Boolean);
  const site = (url.searchParams.get("site") || "").trim();
  const result = await withAgentDb(async (sql) => {
    const embedding = await embedText(q);
    const hits = await searchDocs(sql, {
      query: q,
      visibility: visibilityFor({ id: caller.id, kind: "agent" }),
      types,
      siteId: site,
      embedding,
    });
    return {
      results: hits.map((hit) => ({
        id: hit.entityId,
        doc_type: hit.docType,
        title: hit.title,
        site_id: hit.siteId,
        url: hit.url,
      })),
    };
  });
  if (isResponse(result)) return result;
  return agentOk(result);
}
