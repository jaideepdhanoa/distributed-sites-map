import { NextResponse } from "next/server";
import { roleAllows } from "@/lib/actions/roles";
import { canReadFinancials } from "@/lib/agent/access";
import { askReady } from "@/lib/ask/model";
import { isSession, privateHeaders, requireUser } from "@/lib/guard";
import { loadMapDeals } from "./deals";
import { mapCatalog } from "@/lib/spaces/mapCatalogLoad";
import { triage } from "@/lib/spaces/triage";
import type { DealProps } from "@/lib/types";
import { isExcludedSite } from "@/lib/alerts/excluded";
import { layoutAssessment, assessedSiteIds } from "@/lib/spaces/assessmentLoad";
import { cachedDraft, generateOptions, liveSource } from "@/lib/spaces/generateOptions";

function spatialOnly(data: ReturnType<typeof layoutAssessment>,role:string) {
  if (canReadFinancials(role) || !data?.row.parcelCases) return data;
  return {...data,row:{...data.row,parcelCases:data.row.parcelCases.map(({name,condition,rows,approach})=>({name,condition,rows,approach}))}};
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: privateHeaders });
}
export async function GET(request: Request) {
  const session = await requireUser();
  if (!isSession(session)) return session;
  const params = new URL(request.url).searchParams;
  if (params.get("view") === "map") {
    const deals = await loadMapDeals(session.actionRole, false);
    return json(await mapCatalog(deals.features,undefined,true));
  }
  if (params.get("view") === "portfolio") {
    const deals = await loadMapDeals(session.actionRole, false);
    const mapped = deals.features.flatMap(feature => {
      const deal = feature.properties as DealProps;
      if (deal.kind !== "pipeline" || isExcludedSite(deal.deal_id)) return [];
      const assessment = layoutAssessment(deal.deal_id);
      const cohort = /off[ -]?market/i.test(deal.stage) ? "off-market" : deal.stage_group === "dropped" ? "dropped" : "active";
      return [{ mapped: true, id: deal.deal_id, city: deal.city, name: deal.name || deal.address || deal.deal_id, stage: deal.stage, cohort, ...triage(assessment?.row) }];
    });
    const available = new Set(mapped.map(row => row.id));
    const unlocated = assessedSiteIds().filter(id => !available.has(id)).flatMap(id => {
      const result = layoutAssessment(id);
      if (!result) return [];
      const { row } = result;
      return [{ mapped:false, id, city:id.split("-")[1], name:row.segment ? row.segment + " · " + id : id,
        stage:"Assessment cohort", cohort:row.cohort, ...triage(row) }];
    });
    return json({ rows: [...mapped, ...unlocated] });
  }
  const id = params.get("site") || "";
  const assessment = layoutAssessment(id);
  if (assessment && assessment.row.status !== "needs-image") return json({ assessment:spatialOnly(assessment,session.actionRole) });
  const source = await liveSource(id);
  const draft = source ? await cachedDraft(source).catch(() => null) : null;
  return json({ assessment: draft || assessment, canDraft: Boolean(!draft && source && askReady() && roleAllows(session.actionRole,"contributor")) });
}
export async function POST(request: Request) {
  const session = await requireUser();
  if (!isSession(session)) return session;
  if (!roleAllows(session.actionRole,"contributor")) return json({error:"Contributor access required."},403);
  const id = new URL(request.url).searchParams.get("site") || "";
  const existing = layoutAssessment(id);
  if (existing && existing.row.status !== "needs-image") return json({assessment:spatialOnly(existing,session.actionRole)});
  const source = await liveSource(id);
  if (!source) return json({error:"A parcel-matched aerial is required."},422);
  try { return json({assessment:await generateOptions(source,session.u,request.signal)}); }
  catch { return json({error:"The draft could not be confirmed. Check the source image or retry when drafting is available."},503); }
}
