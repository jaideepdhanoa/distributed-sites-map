import { sheetMoney } from "@/lib/keyNumbers";
import { shownPriceSource } from "@/lib/format";
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
import { reviewAtStage } from "@/lib/selection/opportunity";
import { opportunityRegister } from "@/lib/selection/opportunityLoad";
import { selectionResearch } from "@/lib/selection/researchLoad";
import { investmentScreen, screenSummary, type ScreenSummary, type Inputs, type SelectionRow } from "@/lib/selection/screen";
import { selectedCases,sourceRevision } from "@/lib/charging/source";
import { summarize } from "@/lib/charging/summary";
import { unmappedChargingSite } from "@/lib/charging/unmapped";
import type { DealProps } from "@/lib/types";
import { loadMapDeals } from "./deals";

import type { ActionRole } from "@/lib/actions/roles";

export async function GET() {
  const session = await requireUser();
  if (!isSession(session)) return session;
  return NextResponse.json(await loadSelectionReview(session.actionRole), {headers:privateHeaders});
}
export async function loadSelectionReview(role:ActionRole) {
  const raw = readGeneratedOptional("selection-inputs.json") as Record<string,Inputs> | undefined;
  const current = await loadMapDeals(role);
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
  const financeVisible = canReadFinancials(role);
  const register = financeVisible ? opportunityRegister() : undefined;
  const stages = new Map<string,string>();
  const reasons = new Map<string,string>();
  const evidence = financeVisible ? selectionResearch() : null;
  const active=financeVisible && missing.length ? await selectedCases():null;
  for (const feature of all) {
    const p: Record<string,unknown> = feature.properties || {};
    const id = String(p.deal_id);
    if (isExcludedSite(id)) continue;
    const input = raw?.[id];
    const stage = String(p.stage || "");
    stages.set(id,stage);
    const deal = p as unknown as DealProps;
    const reason = deal.decision_reason || deal.chips?.find(c => c.family === "drop_reason")?.label;
    if (reason) reasons.set(id, reason);
    if (input?.stage && stage !== input.stage) mismatches++;
    if (!stage || /dropped|off[ -]?market/i.test(stage) || p.stage_group === "dropped") continue;
    const city = String(p.city || id.split("-")[1]);
    const a = layoutAssessment(id);
    const view = triage(a?.row);
    const summary = (p.screening as ScreenSummary | undefined) || screenSummary(city,input,view,p);
    const {priority,instruction} = summary;
    const extra=financeVisible && !mapped.has(id)?unmappedChargingSite(id,stage):null;
    const charging=financeVisible ? (p as unknown as DealProps).charging ?? (extra?summarize(extra,sourceRevision(extra),active?.get(id)):undefined) : undefined;
    const priced = mapped.has(id) ? deal : extra;
    const asking = financeVisible && priced && (priced.asking_price != null || priced.asking_price_display)
      ? [sheetMoney(priced.asking_price, priced.asking_price_display), shownPriceSource(priced)].filter(Boolean).join(" · ") : undefined;
    rows.push({id,charging,asking,chargingSpace:financeVisible ? deal.chargingSpace : undefined,
      pendingDrop:financeVisible ? deal.pendingDrop : undefined,review:register?.sites[id],city,name:String(p.name || p.address || register?.sites[id]?.name || id),mapped:Boolean(mapped.get(id)?.geometry),hasRecord:mapped.has(id),stage,mirrorStage:input?.stage || "",
      research:evidence?.get(id),priority,instruction,geometry:!a && typeof input?.recorded === "number" ? input.recorded+" stalls in the workbook" : view.baseline,option:summary.fit || view.finding || view.focus,assessed:Boolean(a),evidenceDate:a?.reviewedOn || "",
      section:input?.section || (input ? "Missing section" : "Workbook input unavailable"),amount:financeVisible ? input?.screen ?? null : null,
      readiness:investmentScreen(input,financeVisible),financeVisible,quickLube:(input?.segment || a?.row.segment || "").toLowerCase().includes("lube") });
  }
  const activeIds = new Set(rows.map(r => r.id));
  const filed = Object.entries(register?.sites ?? {}).filter(([id]) => !activeIds.has(id))
    .map(([id,review]) => {
      const stage = stages.get(id) || "Stage unavailable";
      return {id, city:id.split("-")[1], stage, review:reviewAtStage(review, stage, reasons.get(id))!,
        decisionReason:reasons.get(id), hasRecord:mapped.has(id)};
    });
  return {rows,filed,registerUrl:register?.register,mismatches,hasInputs:Boolean(raw)};
}
