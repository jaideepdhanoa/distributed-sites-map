/**
 * Cutover gate for READ_SITES_FROM_DB.
 * Compares flag-off snapshot types with flag-on site-row types for every deal.
 * Prints counts, keys, and types. Never prints a site value.
 */
import { readFileSync } from "node:fs";
import { applySiteRows } from "../lib/changes/read.ts";
import { sitesFromFiles } from "../lib/changes/site.ts";
import { typeMismatches } from "../lib/changes/parity.ts";
import { withPricing } from "../lib/pricingLoad.ts";

type Feature = { properties?: { kind?: unknown }; geometry?: unknown };

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function apiShape(feature: Feature) {
  const priced = withPricing(feature as { properties?: object | null });
  return {
    geometry: jsonClone(priced.geometry ?? null),
    properties: jsonClone(priced.properties ?? {}),
  };
}

function main() {
  const dealsText = readFileSync("data/generated/deals.geojson", "utf8");
  const pricingText = readFileSync("data/generated/pricing.json", "utf8");
  const file = JSON.parse(dealsText) as { features?: Feature[] };
  const features = file.features || [];
  const painted = applySiteRows(JSON.parse(dealsText) as { features?: Feature[] }, sitesFromFiles(dealsText, pricingText));
  const paintedFeatures = painted.features || [];
  const counts = new Map<string, number>();
  let pipeline = 0;
  let land = 0;
  if (paintedFeatures.length !== features.length) {
    console.log(`mismatch 1 features length ${features.length}->${paintedFeatures.length}`);
    console.log("mismatches 1");
    process.exit(1);
  }
  for (let index = 0; index < features.length; index += 1) {
    const kind = features[index]?.properties?.kind;
    if (kind === "pipeline") pipeline += 1;
    else if (kind === "land") land += 1;
    for (const row of typeMismatches(apiShape(features[index]!), apiShape(paintedFeatures[index]!), "feature")) {
      counts.set(row, (counts.get(row) || 0) + 1);
    }
  }
  const sites = JSON.parse(readFileSync("data/generated/sites.geojson", "utf8")) as { features?: unknown[] };
  console.log(`deals ${features.length}`);
  console.log(`pipeline ${pipeline}`);
  console.log(`land ${land}`);
  console.log(`sites ${sites.features?.length || 0}`);
  console.log("sites overlay none");
  if (counts.size) {
    for (const [row, count] of [...counts.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
      console.log(`mismatch ${count} ${row}`);
    }
    console.log(`mismatches ${[...counts.values()].reduce((sum, count) => sum + count, 0)}`);
    process.exit(1);
  }
  console.log("mismatches 0");
}

try {
  main();
} catch (error) {
  const name = error instanceof Error ? error.name : "Error";
  console.error(`parity failed: ${name}`);
  process.exit(1);
}
