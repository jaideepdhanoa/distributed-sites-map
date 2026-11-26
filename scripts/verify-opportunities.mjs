import { existsSync, readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import opportunity from "../lib/selection/opportunity.ts";
import { signedInReleaseReader } from "./verify-space-layouts.mjs";

const path = "data/generated/opportunity-reviews.json";
if (existsSync(path)) {
  let expected;
  try { expected = opportunity.parseOpportunities(JSON.parse(readFileSync(path, "utf8"))); }
  catch { throw Error("The opportunity register failed validation. Check roles, dates, ranks, review fields and site IDs."); }
  const count = Object.keys(expected.sites).length;
  if (process.argv.includes("--live")) {
    const read = await signedInReleaseReader("https://distributedsites.com", {
      username: process.env.E2E_USERNAME, password: process.env.E2E_PASSWORD,
    });
    let verified = false;
    for (let attempt = 0; attempt < 5 && !verified; attempt++) {
      if (attempt) await sleep(15000);
      const [portfolio, map] = await Promise.all([read("/api/data/selection-review"), read("/api/data/deals")]);
      if (!portfolio.ok || !map.ok) continue;
      const {rows, filed, registerUrl} = await portfolio.json();
      const {features} = await map.json();
      const actual = new Map([...rows, ...(filed || [])].filter(r => r.review).map(r => [r.id, r.review]));
      verified = registerUrl === expected.register && actual.size === count &&
        Object.entries(expected.sites).every(([id, site]) => isDeepStrictEqual(site,actual.get(id))) &&
        features.every(({properties:p}) => p.kind !== "pipeline" || isDeepStrictEqual(expected.sites[p.deal_id],p.opportunityReview));
    }
    if (!verified) throw Error("Signed-in opportunity review readback did not match the private register.");
  }
  console.log("Verified opportunity register sites:", count);
}
