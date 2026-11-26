import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as pause } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { signedInReleaseReader } from "./verify-space-layouts.mjs";

// Check the same read used by the map and comparisons. Only aggregate counts
// leave this process. The source workbook, evidence and site IDs stay private.
const file = JSON.parse(await readFile("data/generated/purchase-review.json","utf8"));
const read = await signedInReleaseReader("https://distributedsites.com", {
  username:process.env.E2E_USERNAME, password:process.env.E2E_PASSWORD,
});
async function check() {
  const response = await read("/api/data/deals");
  if (!response.ok) return null;
  const {features} = await response.json();
  const rows = features.map(f => f.properties).filter(d => d.kind === "pipeline" && file.sites[d.deal_id]);
  if (!rows.length && Object.keys(file.sites).length) return null;
  for (const deal of rows) {
    const expected = file.sites[deal.deal_id];
    if (!isDeepStrictEqual(file.assumptions,deal.purchase?.assumptions)) return null;
    for (const [key, value] of Object.entries(expected)) {
      if ((value === null || typeof value === "number") && deal.purchase.inputs[key] !== value) return null;
    }
  }
  return { records:rows.length, annualCash:rows.filter(d=>d.purchase.inputs.cash!=null).length };
}
let result = null;
for (let attempt=0; attempt<5 && !result; attempt++) {
  if (attempt) await pause(15000*attempt);
  result = await check().catch(()=>null);
}
if (!result) throw Error("The signed-in financial inputs did not match the published snapshot.");
console.log("Financial inputs verified on "+result.records+" operating records, including "+result.annualCash+" annual cash calculations.");
await writeFile(".purchase-review-readback","verified\n");
