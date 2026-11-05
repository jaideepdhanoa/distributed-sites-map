import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inStage } from "../lib/filter.ts";
import { collectSearchHits, foldSearch, matchesQuery, partyMatch, siteSearchParts } from "../lib/search.ts";
import type { DealProps, SiteProps } from "../lib/types.ts";

assert.equal(foldSearch("Stars & Stripes"), "stars and stripes");
assert.equal(matchesQuery("stars and stripes", ["Stars & Stripes"]), true);
assert.equal(matchesQuery("7520", ["7520 W McNab Rd"]), true);
assert.equal(matchesQuery("McNab", ["7520 W McNab Rd"]), true);
assert.equal(partyMatch("Matthews", "Colin McGourty", "Matthews"), true);
assert.equal(partyMatch("Matthews", "Assaf", "Matthews"), true);
assert.equal(partyMatch("Matthews", "", "Kidder Mathews"), false);
assert.equal(partyMatch("Colin McGourty", "Colin McGourty", "Matthews"), true);

const deals = (JSON.parse(readFileSync("data/generated/deals.geojson", "utf8")) as { features: { properties: DealProps }[] }).features.map((feature) => feature.properties);
const sites = (JSON.parse(readFileSync("data/generated/sites.geojson", "utf8")) as { features: { properties: SiteProps }[] }).features.map((feature) => feature.properties);

function hits(query: string) {
  return collectSearchHits(query, deals, sites, (site) => {
    const full = sites.find((item) => item.site_id === site.site_id);
    if (!full) return "universe";
    for (const step of ["cleared", "county", "land", "in_area", "universe"] as const) {
      if (inStage(full, step)) return step;
    }
    return "universe";
  });
}

for (const query of ["stars and stripes", "7520", "McNab", "PIPE-MIA-0080", "MIA-U747"]) {
  const found = hits(query);
  assert.ok(found.some((hit) => hit.id === "PIPE-MIA-0080"), `${query} should list PIPE-MIA-0080`);
  assert.ok(found.some((hit) => hit.id === "MIA-U747"), `${query} should list MIA-U747`);
}
assert.equal(hits("stars and stripes")[0]?.id, "PIPE-MIA-0080");
const matthews = deals.filter((deal) => partyMatch("Matthews", deal.broker, deal.firm)).map((deal) => deal.deal_id).sort();
assert.deepEqual(matthews, ["PIPE-MIA-0080", "PIPE-PHX-0007"]);

const queries = ["car wash", "LLC", "wash", "PHX-U1", "LAS-U1", "MIA-U1"];
for (const site of sites) {
  const raw = `${site.site_id} ${site.name || ""} ${site.also_known_as || ""} ${site.address || ""} ${site.apn || ""} ${site.owner || ""}`.toLowerCase();
  for (const query of queries) {
    assert.equal(matchesQuery(query, siteSearchParts(site)), raw.includes(query.toLowerCase()), `${site.site_id} ${query}`);
  }
}

console.log("search ok");
