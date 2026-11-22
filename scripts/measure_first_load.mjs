/**
 * Time a cold parse of the published files against the cached reader.
 * Run: node --import tsx scripts/measure_first_load.mjs
 */
import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { readGenerated, resetParsedSnapshotCache } from "../lib/snapshot/read.ts";

const names = ["sites.geojson", "deals.geojson"];

function coldParse() {
  const started = performance.now();
  for (const name of names) JSON.parse(readFileSync(`data/generated/${name}`, "utf8"));
  return performance.now() - started;
}

function warmRead() {
  resetParsedSnapshotCache();
  for (const name of names) readGenerated(name);
  const started = performance.now();
  for (const name of names) readGenerated(name);
  return performance.now() - started;
}

const cold = coldParse();
const warm = warmRead();
console.log(JSON.stringify({
  coldParseMs: Math.round(cold),
  cachedReadMs: Math.round(warm * 10) / 10,
  files: names,
}));
