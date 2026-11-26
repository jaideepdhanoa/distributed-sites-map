import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("selection review distinguishes an unanswered check from zero savings", async ({page},info) => {
  const row = {id:"PIPE-PHX-9999",name:"Example service center",city:"PHX",mapped:false,stage:"1 Desk screen",mirrorStage:"1 Desk screen",
    readiness:"Base case below 30% hurdle",priority:"Test conversion",instruction:"Measure the bay and confirm retained operations.",geometry:"0 stalls in the earlier screen",option:"Service building",
    section:"Missing section",amount:0,financeVisible:true,assessed:true,evidenceDate:"",quickLube:false};
  await page.route("**/api/data/selection-review", r=>r.fulfill({json:{rows:[row,{...row,id:"PIPE-LAS-9999",city:"LAS",name:"Example wash",amount:null}],mismatches:0,hasInputs:true}}));
  await page.goto("/selection-review");
  await expect(page.getByText("Workbook base savings: Unmodeled")).toBeVisible();
  await page.getByLabel("Market",{exact:true}).selectOption("PHX");
  await expect(page.getByText("1 of 2 active sites")).toBeVisible();
  await expect(page.getByText("Workbook base savings: 0.0%")).toBeVisible();
  await expect(page.getByRole("link",{name:"Review layout evidence"})).toHaveAttribute("href",/space-review\?site=/);
  expect(await page.locator("main").evaluate(el=>el.scrollWidth<=el.clientWidth)).toBeTruthy();
  await mkdir("review-shots",{recursive:true});
  await page.screenshot({path:"review-shots/"+info.project.name+"-selection-review.png",animations:"disabled"});
});

test("released selection review joins uniquely and serves active rows", async ({page},info) => {
  test.skip(process.env.MAP_PRODUCTION_CHECK !== "1","Requires the released application.");
  test.setTimeout(27*60_000);
  // The signed-in app can deploy before the normal workbook publication.
  await expect.poll(async () => {
    const probe = await page.request.get("/api/data/selection-review");
    if (!probe.ok()) return false;
    return (await probe.json()).hasInputs === true;
  }, {timeout:25*60_000, intervals:[15_000,30_000,60_000]}).toBe(true);
  const response = await page.request.get("/api/data/selection-review");
  expect(response.status()).toBe(200);
  const result = await response.json();
  const rows: {id:string;stage:string}[] = result.rows;
  expect(rows.length).toBeGreaterThan(0);
  expect(new Set(rows.map(r=>r.id)).size).toBe(rows.length);
  expect(rows.every(r=>!(/dropped|off[ -]?market/i.test(r.stage)))).toBe(true);
  const dealsResponse = await page.request.get("/api/data/deals");
  expect(dealsResponse.ok()).toBe(true);
  const deals = await dealsResponse.json();
  const activeIds = new Set(rows.map(r=>r.id));
  const mappedActive = deals.features.filter((f: {properties: {kind:string;stage:string;stage_group:string}}) =>
    f.properties.kind === "pipeline" && Boolean(f.properties.stage) && f.properties.stage_group !== "dropped" &&
    !/dropped|off[ -]?market/i.test(f.properties.stage));
  expect(mappedActive.every((f: {properties:{deal_id:string}})=>activeIds.has(f.properties.deal_id))).toBe(true);
  console.info("Selection parity",info.project.name,JSON.stringify({active:rows.length,stageDifferences:result.mismatches,workbookInputs:result.hasInputs}));
  await page.goto("/selection-review");
  await expect(page.getByText(rows.length+" of "+rows.length+" active sites")).toBeVisible();
});
