import { NextResponse } from "next/server";
import { isSession, privateHeaders, requireUser } from "@/lib/guard";
import { canReadFinancials } from "@/lib/agent/access";
import { isExcludedSite } from "@/lib/alerts/excluded";
import { overlayHeldStages } from "@/lib/changes/heldStage";
import { overlayDealStages } from "@/lib/changes/read";
import { overlayStageFile } from "@/lib/stageOverlayLoad";
import { readGeneratedOptional } from "@/lib/snapshot/read";
import { assessedSiteIds, layoutAssessment } from "@/lib/spaces/assessmentLoad";
import { triage } from "@/lib/spaces/triage";
import { investmentScreen, selectionCheck, type Inputs, type SelectionRow } from "@/lib/selection/screen";
import { loadMapDeals } from "./deals";

export async function GET() {
  const session = await requireUser();
  if (!isSession(session)) return session;
  const raw = readGeneratedOptional("selection-inputs.json") as Record<string,Inputs> | undefined;
  const current = await loadMapDeals(session.actionRole);
  const mapped = new Map(current.features.filter(f => f.properties?.kind === "pipeline").map(f => [String(f.properties?.deal_id), f]));
  const missing = (raw ? Object.keys(raw) : assessedSiteIds()).filter(id => !mapped.has(id) && !isExcludedSite(id));
  const features = missing.map(id => {
    const cohort = raw ? undefined : layoutAssessment(id)?.row.cohort;
    const stage = raw?.[id]?.stage || (cohort === "active" ? "Active assessment cohort" : cohort || "");
    return { properties: {deal_id:id, stage, stage_group:""} };
  });
  const offMap = await overlayHeldStages(await overlayDealStages(await overlayStageFile({features}, "deal")), "deal");
  const all = [...mapped.values(), ...offMap.features];
  const rows: SelectionRow[] = [];
  let mismatches = 0;
  const financeVisible = canReadFinancials(session.actionRole);
  for (const feature of all) {
    const p: Record<string,unknown> = feature.properties || {};
    const id = String(p.deal_id);
    if (isExcludedSite(id)) continue;
    const input = raw?.[id];
    const stage = String(p.stage || "");
    if (input?.stage && stage !== input.stage) mismatches++;
    if (!stage || /dropped|off[ -]?market/i.test(stage) || p.stage_group === "dropped") continue;
    const city = String(p.city || id.split("-")[1]);
    const a = layoutAssessment(id);
    const view = triage(a?.row);
    const [priority,instruction] = selectionCheck(city,input,view.focus,p.listing_removed === true);
    rows.push({id,city,name:String(p.name || p.address || id),mapped:Boolean(mapped.get(id)?.geometry),stage,mirrorStage:input?.stage || "",
      priority,instruction,geometry:!a && typeof input?.recorded === "number" ? input.recorded+" stalls in the workbook" : view.baseline,option:view.finding || view.focus,assessed:Boolean(a),evidenceDate:a?.reviewedOn || "",
      section:input?.section || (input ? "Missing section" : "Workbook input unavailable"),amount:financeVisible ? input?.screen ?? null : null,
      readiness:investmentScreen(input,financeVisible),financeVisible,quickLube:(input?.segment || a?.row.segment || "").toLowerCase().includes("lube") });
  }
  return NextResponse.json({rows,mismatches,hasInputs:Boolean(raw)}, {headers:privateHeaders});
}
