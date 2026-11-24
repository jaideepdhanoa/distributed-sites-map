import { canCapture } from "@/lib/agent/identity";
import { canonicalUrl } from "@/lib/agent/links";
import { agentOk, isAgentCaller, requireAgent, withAgentDb } from "@/lib/agent/http";
import { isResponse, jsonError } from "@/lib/actions/http";
import { isProtectedId } from "@/lib/protectedSite";
import { readGenerated } from "@/lib/guard";

type Feature = { properties?: Record<string, unknown> };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const caller = requireAgent(request);
  if (!isAgentCaller(caller)) return caller;
  const { id } = await context.params;
  const siteId = decodeURIComponent(id || "").trim();
  if (!siteId || isProtectedId(siteId)) return jsonError("Not found", 404);
  const sites = (readGenerated("sites.geojson") as { features?: Feature[] }).features || [];
  const deals = (readGenerated("deals.geojson") as { features?: Feature[] }).features || [];
  const site = sites.find((feature) => text(feature.properties?.site_id) === siteId)?.properties;
  const deal = deals.find((feature) => text(feature.properties?.deal_id) === siteId)?.properties;
  const props = deal || site;
  if (!props || isProtectedId(text(props.site_id)) || isProtectedId(text(props.deal_id)) || isProtectedId(text(props.linked_deal_id))) {
    return jsonError("Not found", 404);
  }
  const result = await withAgentDb(async (sql) => {
    const stageRow = await sql.query<{ stage: string }>(`SELECT stage FROM site_stages WHERE site_id = $1`, [siteId]);
    const stage = text(stageRow.rows[0]?.stage) || text(props.pipeline_stage) || text(props.stage) || text(props.stage_group);
    const comms = await sql.query<{ entity_id: string; direction: string; at: string }>(
      `SELECT entity_id, coalesce(payload->>'direction', '') AS direction, coalesce(payload->>'at', '') AS at
       FROM comms_entries
       WHERE upper(site_id) = upper($1)
       ORDER BY updated_at DESC
       LIMIT 5`,
      [siteId],
    );
    const chips = [text(props.city), stage].filter(Boolean);
    const body: Record<string, unknown> = {
      id: siteId,
      site: {
        id: siteId,
        name: text(props.name),
        address: text(props.address),
        city: text(props.city),
        category: text(props.business_type) || text(props.category),
      },
      stage,
      comms: comms.rows.map((row) => ({
        id: row.entity_id,
        direction: row.direction,
        at: row.at,
        url: canonicalUrl({ siteId, panel: "activity", msg: row.entity_id }),
      })),
      url: canonicalUrl({ siteId }),
    };
    if (chips.length) body.chips = chips;
    if (canCapture(caller.id) || caller.id === "shared") {
      const lines = await sql.query<{ n: string }>(`SELECT count(*)::text AS n FROM pnl_lines WHERE site_id = $1`, [siteId]);
      const count = Number(lines.rows[0]?.n || 0);
      body.financials = {
        summary: count ? "Financial lines are on file." : "No financial summary on file.",
        url: canonicalUrl({ siteId, panel: "financials" }),
      };
    }
    return body;
  });
  if (isResponse(result)) return result;
  return agentOk(result);
}
