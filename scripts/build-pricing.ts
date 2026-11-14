import { readFileSync, writeFileSync } from "node:fs";
import { landCompSets, priceWorkbook, type CompSource, type FactRow, type SiteInput } from "../lib/pricing.ts";

const source = JSON.parse(readFileSync(new URL("../data/pricing/sources.json", import.meta.url), "utf8")) as {
  asOf: string;
  workbook: string;
  land: CompSource[];
  register: CompSource[];
  sites: SiteInput[];
  facts: FactRow[];
};
const { markets } = landCompSets(source.land, source.register);
const deals = priceWorkbook(source.sites, source.facts, markets);
const payload = {
  asOf: source.asOf,
  workbook: source.workbook,
  markets,
  deals,
};
writeFileSync(new URL("../data/generated/pricing.json", import.meta.url), `${JSON.stringify(payload, null, 2)}\n`);
console.log(`priced ${Object.keys(deals).length} sites`);
for (const market of markets) console.log(`${market.metro} ${market.reach} ${market.count} ${Math.round(market.medianPerAcre)}`);
