import { openActions,isResponse,jsonOk,jsonError,runWrite } from "@/lib/actions/http";
import { isSession,requireUser } from "@/lib/guard";
import { canReadFinancials } from "@/lib/agent/access";
import { actionsEnabled,withSql } from "@/lib/actions/db";
import { isProtectedId } from "@/lib/protectedSite";
import type { ActionRole } from "@/lib/actions/roles";
import type { DealProps } from "@/lib/types";
import { loadMapDeals } from "../data/deals";
import { caseHistory,saveCase } from "@/lib/charging/store";
import { sourceRevision } from "@/lib/charging/source";
import { unmappedChargingSite } from "@/lib/charging/unmapped";
import { initialCase } from "@/lib/charging/model";
import { saveSchema } from "@/lib/charging/schema";
import { overlayStageFile } from "@/lib/stageOverlayLoad";
import { overlayHeldStages } from "@/lib/changes/heldStage";
import { overlayDealStages } from "@/lib/changes/read";

async function siteFor(request:Request,role:ActionRole) {
  const id=new URL(request.url).searchParams.get("site")||"";
  if(!/^PIPE-(LAS|MIA|PHX)-\d{4}$/.test(id)||isProtectedId(id))return null;
  const data=await loadMapDeals(role);
  const mapped=data.features.find(f=>f.properties?.deal_id===id)?.properties as DealProps|undefined;
  if(mapped)return mapped.charging?mapped:null;
  const site=unmappedChargingSite(id);
  if(!site)return null;
  const staged=await overlayHeldStages(await overlayDealStages(await overlayStageFile({features:[{properties:{deal_id:id,stage:site.stage,stage_group:""}}]},"deal")),"deal");
  return unmappedChargingSite(id,String(staged.features[0]?.properties?.stage??site.stage));
}
export async function GET(request:Request) {
  const session=await requireUser();
  if(!isSession(session))return session;
  if(!canReadFinancials(session.actionRole))return jsonError("Financial access required.",403);
  const site=await siteFor(request,session.actionRole);
  if(!site)return jsonError("Site unavailable.",404);
  let history=null;
  if(actionsEnabled()){
    try {history=await withSql(sql=>caseHistory(sql,site.deal_id));}catch { /* A draft stays available when shared storage is offline. */ }
  }
  return jsonOk({site,source:site.charging?.sourceRevision??sourceRevision(site),history,canWrite:session.actionRole!=="viewer" && history!==null});
}
export async function POST(request:Request) {
  const session=await openActions("contributor");
  if(isResponse(session))return session;
  if(!canReadFinancials(session.actionRole))return jsonError("Financial access required.",403);
  const parsed=saveSchema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return jsonError(parsed.error.issues[0]?.message||"Invalid scenario.",400);
  const site=await siteFor(request,session.actionRole);
  if(!site)return jsonError("Site unavailable.",404);
  if(parsed.data.sourceRevision!==(site.charging?.sourceRevision??sourceRevision(site)))return jsonError("The site evidence changed. Reload and review the new inputs.",409);
  if(parsed.data.inputs.comparator==="workbook" && parsed.data.inputs.values.depot!==initialCase(site).values.depot)return jsonError("Refresh the filed depot proxy or select a local benchmark.",409);
  const history=await runWrite(session,{action:"charging.case",targetId:site.deal_id},sql=>saveCase(sql,site.deal_id,session.u,parsed.data));
  return isResponse(history)?history:jsonOk({history});
}
