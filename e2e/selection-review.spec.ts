import { createHash } from "node:crypto";
import { marketSequence,meritVersion } from "../lib/charging/merit";
import type { SelectionRow } from "../lib/selection/screen";
import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("selection review distinguishes an unanswered check from zero savings", async ({page},info) => {
  const row = {id:"PIPE-PHX-9999",name:"Example service center",city:"PHX",mapped:false,stage:"1 Desk screen",mirrorStage:"1 Desk screen",
    readiness:"Base case below 30% hurdle",priority:"Test conversion",instruction:"Measure the bay and confirm retained operations.",geometry:"0 stalls in the earlier screen",option:"Service building",
    research:{reviewedOn:"2026-01-01",priority:"Confirm aisle rights",check:"Check the exclusive yard.",scope:"Example property",note:"Example floor plan.",quote:100000,basis:"Illustrative price",source:null,cases:[{stalls:4,base:0,stress:-0.1}]},
    section:"Missing section",amount:0,financeVisible:true,assessed:true,evidenceDate:"",quickLube:false};
  await page.route("**/api/data/selection-review", r=>r.fulfill({json:{rows:[row,{...row,id:"PIPE-LAS-9999",city:"LAS",name:"Example wash",amount:null}],mismatches:0,hasInputs:true}}));
  await page.goto("/selection-review");
  await expect(page.getByText("Workbook base savings: Unmodeled")).toBeVisible();
  await page.getByLabel("Market",{exact:true}).selectOption("PHX");
  await expect(page.getByText("1 of 2 active sites")).toBeVisible();
  await expect(page.getByText("Workbook base savings: 0.0%")).toBeVisible();
  await expect(page.getByRole("link",{name:"Review layout evidence"})).toHaveAttribute("href",/space-review\?site=/);
  await page.getByText("Offering and downside",{exact:false}).click();
  await expect(page.getByRole("row",{name:"4 0.0% -10.0%"})).toBeVisible();
  expect(await page.locator("main").evaluate(el=>el.scrollWidth<=el.clientWidth)).toBeTruthy();
  await mkdir("review-shots",{recursive:true});
  await page.screenshot({path:"review-shots/"+info.project.name+"-selection-review.png",animations:"disabled"});
  await page.route("**/api/data/space-options?view=portfolio", route=>route.fulfill({json:{rows:[{...row,cohort:"active",kinds:[],options:[],focus:"Test a conversion"}]}}));
  await page.getByRole("link",{name:"Review layout evidence"}).click();
  await page.getByRole("link",{name:/Back to selection review/}).click();
  await expect(page.getByLabel("Market",{exact:true})).toHaveValue("PHX");
  await expect(page.getByText("1 of 2 active sites")).toBeVisible();
  const originalRow=page.locator("li").filter({hasText:row.name});
  await expect(originalRow).toBeFocused();
  await originalRow.getByRole("link",{name:"Review layout evidence"}).click();
  await expect(page.getByRole("link",{name:/Back to selection review/})).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel("Market",{exact:true})).toHaveValue("PHX");
  await expect.poll(()=>originalRow.evaluate(row=>row.contains(document.activeElement))).toBe(true);
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
  const financialRows=(result.rows as SelectionRow[]).filter(r=>r.charging);
  expect(financialRows.length).toBeGreaterThan(0);
  expect(financialRows.every(r=>r.charging?.merit.version===meritVersion)).toBe(true);
  const ranks=marketSequence(financialRows.map(r=>({id:r.id,city:r.city,merit:r.charging!.merit})));
  const digestRows=financialRows.map(row=>{
    const c=row.charging!,m=c.merit,rank=ranks.get(row.id);
    return [row.id,c.selected?.split(":").pop()??"",m.action,m.next,m.downsideGap,m.downsideCeiling,m.netValue,
      rank?.rank,rank?.value,rank?.peak,m.version].map(v=>typeof v==="number" ? v.toPrecision(12) : v??"");
  }).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
  const fingerprint=createHash("sha256").update(JSON.stringify(digestRows)).digest("hex");
  console.info("Charging decision readback",JSON.stringify({rows:financialRows.length,ranked:ranks.size,version:meritVersion,fingerprint}));
  await page.goto("/selection-review");
  await expect(page.getByText(new RegExp(`^\\d+ of ${rows.length} active sites$`))).toBeVisible();
});

test("rank eligible sites by market and allocate a shared peak once", async ({page},info) => {
  const load={sessions:1200,peak:8,annualFixed:8400,variable:2};
  const network={pool:"weekday west",annualNeed:1200,peakNeed:8,avoided:12,years:4,rate:0,depot:12,base:load,downside:load,yearOne:25000};
  const merit={version:"site-merit/1",action:"Advance diligence",next:"Review the funded operating plan.",order:0,checkCost:null,checkDays:null,
    downsideGap:-3,downsideCeiling:50000,netValue:14400,servedPeak:8,network};
  const row={id:"PIPE-LAS-9997",city:"LAS",name:"West dispatch site",priority:"Verify a condition",instruction:"Verify the plan.",stage:"2 Financial screen",
    amount:null,section:"Ranked",mapped:true,financeVisible:true,readiness:"Local case",charging:{name:"Paid shifts",selected:"demo:1",merit,
      comparator:"local",screen:[],result:{siteCost:9,depot:12,earlyMin:20}}};
  const peer={...row,id:"PIPE-LAS-9998",name:"West alternative"};
  const incomplete={...row,id:"PIPE-LAS-9999",name:"Unmeasured bay",charging:{...row.charging,merit:{...merit,action:"Verify a condition",order:1,netValue:null,network:null,next:"Measure bay circulation."}}};
  await page.route("**/api/data/selection-review",r=>r.fulfill({json:{hasInputs:true,mismatches:0,rows:[peer,incomplete,row]}}));
  await page.goto("/selection-review?market=LAS");
  await expect(page.getByText("Measure bay circulation.")).toBeVisible();
  await page.getByLabel("Order",{exact:true}).selectOption("investment");
  await expect(page.getByText("1 of 3 active sites")).toBeVisible();
  await expect(page.getByRole("heading",{name:"West dispatch site"})).toBeVisible();
  await expect(page.getByText(/LAS #1.*14,400.*8 residual peak charges/)).toBeVisible();
  expect(await page.locator("main").evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await mkdir("review-shots",{recursive:true});
  await page.screenshot({path:"review-shots/"+info.project.name+"-investment-sequence.png",animations:"disabled"});
});

test("commercial diligence order, alternate routes and archived reviews", async ({page}, info) => {
  const primary = {route:"Operating acquisition", disposition:"Shortlist", rank:1, rationale:"The seller offered the operating premises.",
    next:"Measure the north aisle during peak use.", reviewedOn:"2026-01-01", owner:null, revisitOn:null, evidence:"https://example.org/record", offering:null};
  const review = {name:"Example operating site",primary,alternatives:[]};
  const hold = {...primary,route:"Offered acquisition",disposition:"Dropped",dropReason:"Tenant lease",rank:null,next:"Reopen on written parking rights."};
  const closed = {name:"Example leased site",primary:hold,alternatives:[{...hold,route:"Host agreement",disposition:"Conditional"}]};
  const row = {city:"LAS",mapped:false,stage:"Desk screen",priority:"Check space",section:"Operating",option:"Layout pending",geometry:"Walk the aisle",financeVisible:true};
  await page.route("**/api/data/selection-review",route=>route.fulfill({json:{mismatches:0,hasInputs:true,
    rows:[{...row,id:"PIPE-LAS-9002",name:closed.name,review:closed},{...row,id:"PIPE-LAS-9001",name:review.name,review}],
    filed:[{id:"PIPE-LAS-9003",city:"LAS",stage:"Dropped",review:{...closed,name:"Archived example"}}]}}));
  await page.goto("/selection-review?scope=PIPE-LAS-9002%7CPIPE-LAS-9001");
  await expect(page.locator(".space-review-results > li").first()).toContainText("Example operating site");
  await expect(page.getByText("Measure the north aisle during peak use.")).toBeVisible();
  await page.getByRole("button",{name:"Show all active sites"}).click();
  await page.getByLabel("Commercial decision").selectOption("Dropped");
  await expect(page.getByText("2 sites with a dropped opportunity")).toBeVisible();
  await page.getByLabel("Drop reason",{exact:true}).selectOption("No longer for sale");
  await expect(page.getByText("0 sites with a dropped opportunity")).toBeVisible();
  await page.getByLabel("Drop reason",{exact:true}).selectOption("Tenant lease");
  await expect(page.getByText("Drop reason · Tenant lease").first()).toBeVisible();
  await page.getByText("Decision evidence and alternative routes").first().click();
  await expect(page.getByRole("heading",{name:"Host agreement · Conditional"}).first()).toBeVisible();
  await expect(page.getByText("Outside the active pipeline (1)")).toBeVisible();
  await expect(page.getByRole("heading",{name:"Archived example"})).toBeVisible();
  expect(await page.locator("main").evaluate(el=>el.scrollWidth<=el.clientWidth)).toBeTruthy();
  await page.screenshot({path:"review-shots/"+info.project.name+"-dropped.png",animations:"disabled"});
  await page.getByLabel("Commercial decision").selectOption("Conditional");
  await expect(page.getByRole("heading",{name:"Conditional",exact:true}).first()).toBeVisible();
  await page.getByText("Route, charging and screening filters").click();
  await page.getByLabel("Transaction route").selectOption("Host agreement");
  await expect(page.getByText("1 of 2 active sites")).toBeVisible();
  await mkdir("review-shots",{recursive:true});
  await page.screenshot({path:"review-shots/"+info.project.name+"-opportunities.png",animations:"disabled"});
});

test("shortlisted visit shows the charging decision and its parallel diligence work", async ({page}, info) => {
  const primary = {route:"Operating acquisition", disposition:"Shortlist", rank:1, rationale:"A bay might be freed.",
    next:"Measure the aisle.", reviewedOn:"2026-01-01", owner:"Reviewer (proposed)", revisitOn:"2026-01-12",
    evidence:"https://example.org/record", offering:null};
  const visitPlan = {decision:"Confirm access", reason:"Measure the service bay while the queue is active.",
    commercial:"Reconcile the operating receipts.", power:"Scope a utility discovery request.",
    beforeVisit:"Confirm access to the yard.", fieldwork:"Measure the turn with a queue present.",
    scenario:"Compare both footprints.", basis:"Illustrative network reference.", beforeLoi:"Verify rights and retained income."};
  const row = {id:"PIPE-LAS-9001",city:"LAS",name:"Example service yard",stage:"Desk screen",mapped:false,
    priority:"Check space",section:"Operating",financeVisible:true,review:{name:"Example service yard",primary,alternatives:[],visitPlan},
    charging:{merit:{action:"Review for closure",next:"Review the original outdoor layout.",netValue:null},
      name:"Screen",result:{siteCost:null},screen:[],selected:null}};
  await page.route("**/api/data/selection-review",route=>route.fulfill({json:{rows:[row],hasInputs:true,mismatches:0}}));
  await page.goto("/selection-review?disposition=Shortlist");
  await expect(page.getByRole("heading",{name:"Acquisition shortlist"})).toBeVisible();
  await expect(page.getByRole("link",{name:/needing my approval/})).toHaveAttribute("href",/qapprove=1/);
  await expect(page.getByText("Site evidence and economics")).toBeVisible();
  await mkdir("review-shots",{recursive:true});
  await page.screenshot({path:"review-shots/"+info.project.name+"-acquisition-shortlist.png",animations:"disabled"});
  await page.getByRole("button",{name:"Filter shortlist"}).click();
  await expect(page.getByLabel("Commercial decision")).toBeVisible();
  await page.getByRole("button",{name:"Hide filters"}).click();
  const card = page.locator(".visit-decision");
  await expect(card.getByText(visitPlan.reason)).toBeVisible();
  await expect(card.getByText(/Review for closure/)).toBeVisible();
  await expect(card.getByText(/Reviewer.*2026-01-12/)).toBeVisible();
  await card.getByText("Actions and offer conditions").click();
  await expect(card.getByText(visitPlan.power,{exact:false})).toBeVisible();
  await expect(card.getByText(visitPlan.beforeLoi,{exact:false})).toBeVisible();
  expect(await page.locator("main").evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await mkdir("review-shots",{recursive:true});
  await card.screenshot({path:"review-shots/"+info.project.name+"-visit-decision.png",animations:"disabled"});
  await card.getByText("Test cash needed while waiting for power").click();
  await expect(card.getByRole("table")).toHaveCount(0);
  await card.getByLabel("Months from closing to power").fill("3");
  await card.getByLabel("Cash required at closing ($)",{exact:true}).fill("100");
  await card.getByLabel(/Monthly operating cash/).fill("-10");
  await card.getByLabel(/Monthly financing/).fill("10");
  await expect(card.getByRole("row",{name:/month 9/})).toContainText("$280");
  await card.getByLabel(/Monthly operating cash/).fill("20");
  await expect(card.getByRole("row",{name:/month 15/})).toContainText("$100");
});
