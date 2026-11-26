import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { signedInReleaseReader } from "./verify-space-layouts.mjs";
import research from "../lib/selection/research.ts";

const path = "data/generated/selection-evidence.json";
let body;
try { body = await readFile(path,"utf8"); } catch (err) {
  if (err.code !== "ENOENT") throw err;
}
if (body) {
  let expected;
  try { expected = research.parseResearch(JSON.parse(body)); }
  catch { throw Error("Selection evidence failed schema validation."); }
  if (!expected.size) throw Error("Selection research is empty.");
  if (process.argv.includes("--live")) {
    const read = await signedInReleaseReader("https://distributedsites.com",{
      username:process.env.E2E_USERNAME,password:process.env.E2E_PASSWORD,
    });
    const review = await read("/api/data/selection-review");
    const deals = await read("/api/data/deals");
    if (!review.ok || !deals.ok) throw Error("Signed-in selection research could not be loaded.");
    const {rows} = await review.json();
    const {features} = await deals.json();
    const mapped = new Map(features.map(f=>[f.properties.deal_id,f.properties]));
    let matches = 0, onMap = 0;
    for (const row of rows) {
      const filed = expected.get(row.id);
      if (!filed) continue;
      if (!row.financeVisible || !isDeepStrictEqual(row.research,filed)) throw Error("Selection research readback mismatch.");
      matches++;
      if (mapped.has(row.id)) {
        if (!isDeepStrictEqual(mapped.get(row.id).selectionResearch,filed)) throw Error("Site record research readback mismatch.");
        onMap++;
      }
    }
    if (!matches) throw Error("No active site matched the selection evidence.");
    await writeFile(".selection-readback","verified\n");
    console.log(JSON.stringify({activeResearch:matches,mappedResearch:onMap,datedSourceRows:expected.size}));
  } else console.log(JSON.stringify({validatedResearch:expected.size}));
}
