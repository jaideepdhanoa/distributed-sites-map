import { existsSync, readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import shortlist from "../lib/selection/acquisitionShortlist.ts";
import opportunity from "../lib/selection/opportunity.ts";
import { signedInReleaseReader } from "./verify-space-layouts.mjs";

const path = "data/generated/opportunity-reviews.json";
if (!existsSync(path)) throw Error("The generated opportunity register is missing.");
{
  let expected;
  try { expected = opportunity.parseOpportunities(JSON.parse(readFileSync(path, "utf8"))); }
  catch { throw Error("The opportunity register failed validation. Check roles, dates, ranks, review fields and site IDs."); }
  const count = Object.keys(expected.sites).length;
  if (process.argv.includes("--live")) {
    const read = await signedInReleaseReader("https://distributedsites.com", {
      username: process.env.E2E_USERNAME, password: process.env.E2E_PASSWORD,
    });
    let verified = false;
    let coverage;
    for (let attempt = 0; attempt < 5 && !verified; attempt++) {
      if (attempt) await sleep(15000);
      const [portfolio, map] = await Promise.all([read("/api/data/selection-review"), read("/api/data/deals")]);
      if (!portfolio.ok || !map.ok) continue;
      const {rows, filed, registerUrl} = await portfolio.json();
      const {features} = await map.json();
      const mapDeals = new Map(features.filter(f => f.properties?.kind === "pipeline").map(f => [f.properties.deal_id, f.properties]));
      const projectionsMatch = rows.every(row => {
        const deal = mapDeals.get(row.id);
        if (!deal) return !row.hasRecord;
        return (row.pipelineTrack==="service") === (expected.sites[row.id]?.primary.disposition === "Service diligence")
          && row.pipelineTrack === deal.pipelineTrack
          && isDeepStrictEqual(row.review,deal.opportunityReview)
          && isDeepStrictEqual(row.charging?.preliminary,deal.charging?.preliminary)
          && isDeepStrictEqual(row.chargingSpace, deal.chargingSpace)
          && row.charging?.sourceRevision === deal.charging?.sourceRevision
          && row.charging?.selected === deal.charging?.selected
          && row.charging?.result?.siteCost === deal.charging?.result?.siteCost
          && row.pendingDrop === deal.pendingDrop;
      });
      const live=rows.filter(r=>r.pipelineTrack==="charging");
      const examples=new Map();
      for(const row of live.filter(r=>r.charging)){
        const lead=row.charging.preliminary?.layouts?.[0];
        const kind=row.charging.selected ? "selected" : lead?.ledger?.validation ? (lead.ledger.hypothetical ? "assumed fit" : "conditional terms") : lead ? "assessed" : "unpriced";
        if(!examples.has(kind)) examples.set(kind,row);
      }
      const editorsMatch=(await Promise.all([...examples.values()].map(async row=>{
        const reply=await read("/api/actions/charging?site="+encodeURIComponent(row.id));
        if(!reply.ok) return false;
        const {site,source}=await reply.json();
        return source===row.charging.sourceRevision && site.charging?.selected===row.charging.selected &&
          isDeepStrictEqual(site.chargingSpace,row.chargingSpace) && isDeepStrictEqual(site.charging?.preliminary,row.charging.preliminary);
      }))).every(Boolean);
      coverage = {
        drawnChargingSites:live.filter(r=>r.chargingSpace?.layouts?.some(l=>l.system)).length,
        pricedChargingSites:live.filter(r=>r.charging?.preliminary?.layouts?.length).length,
        conditionalChargingSites:live.filter(r=>r.charging?.preliminary?.layouts?.[0]?.ledger?.validation).length,
        assumedFitChargingSites:live.filter(r=>r.charging?.preliminary?.layouts?.[0]?.ledger?.hypothetical).length,
        systemChargingCombinations:live.reduce((n,r)=>n+(r.chargingSpace?.layouts?.filter(l=>l.system).length??0),0),
        editorCasesChecked:examples.size,
        activeWithEvidence: rows.filter(r => r.review?.coverage).length,
        footprintScenarios: rows.reduce((n, r) => n + (r.review?.coverage?.cases?.length || 0), 0),
        activeWithoutReview: rows.filter(r => !r.review).length,
        activeWithNextDecision: rows.filter(r => r.review?.primary.next?.trim()).length,
        activeSites: rows.filter(r=>r.pipelineTrack==="charging").length,
        activeShortlist: rows.filter(r => r.review?.primary.disposition === "Shortlist").length,
        shortlistVisitPlans: rows.filter(r => r.review?.primary.disposition === "Shortlist" && r.review.visitPlan).length,
        serviceDiligence: rows.filter(r => r.review?.primary.disposition === "Service diligence").length,
        recommendedDrops: rows.filter(r => r.review?.primary.disposition === "Suggest drop").length,
        filedOutsideActive: filed?.length,
      };
      const actual = new Map([...rows, ...(filed || [])].filter(r => r.review).map(r => [r.id, r]));
      const activeRows = new Map(rows.map(r => [r.id,r]));
      function projected(id, review, stage, reason) {
        const raw = opportunity.reviewAtStage(review, stage || "", reason);
        return activeRows.has(id) ? shortlist.acquisitionReview(raw,mapDeals.get(id) ?? activeRows.get(id)) : raw;
      }
      verified = projectionsMatch && editorsMatch && new Set(rows.map(r => r.id)).size === rows.length &&
        actual.size === count && registerUrl === expected.register &&
        Object.entries(expected.sites).every(([id, site]) => isDeepStrictEqual(projected(id, site, actual.get(id)?.stage, actual.get(id)?.decisionReason),actual.get(id)?.review)) &&
        features.every(({properties:p}) => p.kind !== "pipeline" || isDeepStrictEqual(projected(p.deal_id,expected.sites[p.deal_id], p.stage, p.decision_reason || p.chips?.find(c => c.family === "drop_reason")?.label),p.opportunityReview));
    }
    if (!verified) throw Error("Signed-in opportunity review readback did not match the private register.");
    console.log(JSON.stringify(coverage));
  }
  console.log("Verified opportunity register sites:", count);
}
