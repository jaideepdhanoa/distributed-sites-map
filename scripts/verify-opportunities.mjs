import { existsSync, readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
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
          && isDeepStrictEqual(row.charging?.preliminary,deal.charging?.preliminary)
          && isDeepStrictEqual(row.chargingSpace, deal.chargingSpace)
          && row.charging?.sourceRevision === deal.charging?.sourceRevision
          && row.charging?.selected === deal.charging?.selected
          && row.charging?.result?.siteCost === deal.charging?.result?.siteCost
          && row.pendingDrop === deal.pendingDrop;
      });
      coverage = {
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
      verified = projectionsMatch && new Set(rows.map(r => r.id)).size === rows.length &&
        actual.size === count && registerUrl === expected.register &&
        Object.entries(expected.sites).every(([id, site]) => isDeepStrictEqual(opportunity.reviewAtStage(site, actual.get(id)?.stage || "", actual.get(id)?.decisionReason),actual.get(id)?.review)) &&
        features.every(({properties:p}) => p.kind !== "pipeline" || isDeepStrictEqual(opportunity.reviewAtStage(expected.sites[p.deal_id], p.stage, p.decision_reason || p.chips?.find(c => c.family === "drop_reason")?.label),p.opportunityReview));
    }
    if (!verified) throw Error("Signed-in opportunity review readback did not match the private register.");
    console.log(JSON.stringify(coverage));
  }
  console.log("Verified opportunity register sites:", count);
}
