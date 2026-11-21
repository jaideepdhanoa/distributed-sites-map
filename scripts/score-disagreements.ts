/**
 * Read-only. Prints site ids whose stored score disagrees with the sum of its parts.
 * No writes. No names, addresses, or prices.
 *
 *   npx tsx scripts/score-disagreements.ts
 */
import { readFileSync } from "node:fs";
import { storedScoreView } from "../lib/scoreDisplay.ts";

type Deal = {
  deal_id?: string;
  kind?: string;
  score?: number | null;
  economics_points?: number | null;
  land_points?: number | null;
  power_points?: number | null;
  location_points?: number | null;
  deal_points?: number | null;
  business_type?: string;
};

function main() {
  console.log("dry-run: score disagreements. no writes.");
  const file = JSON.parse(readFileSync("data/generated/deals.geojson", "utf8")) as {
    features?: { properties?: Deal }[];
  };
  let count = 0;
  for (const feature of file.features || []) {
    const deal = feature.properties || {};
    const id = String(deal.deal_id || "").trim();
    if (!id) continue;
    const view = storedScoreView({
      score: deal.score,
      economics: deal.economics_points,
      land: deal.land_points,
      power: deal.power_points,
      location: deal.location_points,
      deal: deal.deal_points,
      naEconomics: String(deal.business_type || "") === "Quick lube",
    });
    if (view.status !== "provisional") continue;
    count += 1;
    console.log(`${id} stored=${view.total} summed=${view.summed}`);
  }
  console.log(`count ${count}`);
}

main();
