import {pipelineCost} from "../lib/charging/pipelineCost";
import {test,expect} from "@playwright/test";
import {mkdir} from "node:fs/promises";
import {calculate,initialCase,modelVersion,type SavedCase} from "../lib/charging/model";
import type {SelectionRow} from "../lib/selection/screen";

test("edit, save, reopen and compare a charging case",async({page},info)=>{
  const site={deal_id:"PIPE-PHX-9998",name:"Example wash and service",asking_price:500000,bays_that_fit:6};
  const source="aaaaaaaaaaaaaaaaaaaaaaaa", inputs=initialCase(site);
  Object.assign(inputs.values,{stalls:6,supply:500,load:100,charger:75,dwell:35,energy:42,efficiency:90,uptime:95,
    demand:5,peak:6,peakCover:6,shortfall:55,posts:1,wage:24,build:600000,upgrade:80000,cash:50000,fixed:25000,
    tax:1,rate:10,closing:2,years:10,depot:12});
  inputs.values.conversion=18000;
  inputs.openEarly="2027-03-01";inputs.openLate="2027-04-01";inputs.depotDate="2027-08-01";
  inputs.comparator="local";inputs.rights="controlled";inputs.rightsSource="Illustrative site plan";inputs.rightsDate="2026-11-01";
  const original:SavedCase={id:"00000000-0000-4000-8000-000000000099",revision:1,author:"Example reviewer",
    name:"Paid coverage",at:"2026-11-01T18:00:00Z",sourceRevision:source,model:modelVersion,inputs,result:calculate(inputs),selected:true};
  let history=[original],latest=source;
  await page.route("**/api/actions/charging?site=*",async route=>{
    if(route.request().method()==="POST"){
      const d=route.request().postDataJSON();
      history=[{...original,id:d.id,revision:d.base+1,name:d.name,sourceRevision:latest,inputs:d.inputs,result:calculate(d.inputs),selected:d.select},
        ...history.map(r=>({...r,selected:d.select?false:r.selected}))];
      await route.fulfill({json:{history}});return;
    }
    await route.fulfill({json:{site,source:latest,history,canWrite:true}});
  });
  const url="/charging?site="+site.deal_id;
  inputs.evidence.conversion={status:"quoted",source:"Synthetic contractor quote",date:"2026-11-01",url:"https://example.org/contractor-estimate"};
  await page.goto(url+"&view=explain&case="+original.id+"%3A1");
  const explanation=page.getByRole("region",{name:"Cost per charge explanation"});
  await expect(explanation).toBeVisible();
  await explanation.getByText("Annual costs and retained cash",{exact:true}).click();
  await explanation.getByText("Construction and interruption",{exact:true}).click();
  await explanation.getByRole("button",{name:"Additional conversion works ($ once)",exact:true}).click();
  await expect(explanation).toContainText("Synthetic contractor quote");
  await expect(explanation.getByRole("link",{name:"Open source document"})).toHaveAttribute("href","https://example.org/contractor-estimate");
  await explanation.getByLabel("Trial value").fill("72000");
  await explanation.getByRole("button",{name:"Apply trial"}).click();
  await expect(explanation).toContainText("Scenario override");
  await expect(explanation).toContainText("Before trial");
  await mkdir("review-shots",{recursive:true});
  const capturePrefix="review-shots/"+info.project.name+"-"+(process.env.MAP_DEPLOYED_PREVIEW?"deployed-":"");
  await explanation.getByRole("region",{name:"Try a change"}).screenshot({path:capturePrefix+"charging-source.png",animations:"disabled"});
  await page.getByLabel("Case name",{exact:true}).fill("Trial conversion");
  await page.getByRole("button",{name:"Save named alternative"}).click();
  await expect(page.getByRole("status")).toContainText("Saved Trial conversion");
  expect(history.find(r=>r.selected)?.name).toBe("Paid coverage");
  await page.reload();
  await expect(page.getByLabel("Case name",{exact:true})).toHaveValue("Trial conversion");
  await explanation.getByLabel("Inspect an input or try a change").selectOption("conversion");
  await expect(explanation).toContainText("Synthetic contractor quote");
  await explanation.getByRole("button",{name:"Review source and date"}).click();
  await expect(page.getByLabel("Recorded source value")).toHaveValue("18000");
  await page.getByRole("button",{name:"Explanation",exact:true}).click();
  await explanation.getByText("What limits completed charges?",{exact:true}).click();
  const overflowing=await explanation.evaluate(el=>{
    const right=el.getBoundingClientRect().right+1;
    return Array.from(el.querySelectorAll("*")).filter(node=>node.getBoundingClientRect().right>right).map(node=>node.tagName+"."+node.className).slice(0,8);
  });
  expect(overflowing).toEqual([]);
  await mkdir("review-shots",{recursive:true});
  await page.getByRole("heading",{name:site.name}).scrollIntoViewIfNeeded();
  const screenshotName=info.project.name+"-"+(process.env.MAP_DEPLOYED_PREVIEW?"deployed-":"")+"charging-explanation.png";
  await page.screenshot({path:"review-shots/"+screenshotName,animations:"disabled"});
  await page.goto(url);
  const editor=page.getByRole("region",{name:"Charging economics editor"});
  const metric=editor.locator(".charging-metrics");
  await expect(metric).toContainText("Local depot per charge");
  await expect(page.getByLabel("Host coverage hours per weekday",{exact:true})).toHaveValue("0");
  await mkdir("review-shots",{recursive:true});
  const name="review-shots/"+info.project.name+"-"+(process.env.MAP_DEPLOYED_PREVIEW?"deployed-":"")+"charging-parity.png";
  await page.screenshot({path:name,animations:"disabled"});
  await page.getByRole("button",{name:"Start a conversion downside case"}).click();
  await page.getByLabel("Additional conversion works ($ once)",{exact:true}).fill("50000");
  await page.getByLabel("Host coverage hours per weekday",{exact:true}).fill("5");
  await expect(page.getByLabel("Moove coverage hours per weekday",{exact:true})).toHaveValue("19");
  await page.getByLabel("Case name",{exact:true}).fill("Weekday host");
  await page.getByText("Site decision and joint downside",{exact:true}).click();
  await page.getByLabel("Dispatch pool identifier").fill("Example south peak");
  await page.getByLabel("Residual charges per peak shift",{exact:true}).fill("0");
  await page.getByLabel("Downside · Annual charging upkeep, insurance and supervision ($)",{exact:true}).fill("30000");
  await page.getByLabel("Market valuation date").fill("2027-01-01");
  await page.getByText("Additional network cash flows",{exact:true}).click();
  await page.getByRole("button",{name:"Add cash schedule"}).click();
  await page.getByLabel("Shared obligation ID").fill("Example lease");
  await page.getByLabel("Cash-flow evidence").fill("Example cancellation exhibit");
  await page.getByLabel("Payment date").fill("2027-05-01");
  await page.getByLabel("Without site ($)",{exact:true}).fill("500");
  await page.getByLabel("With site ($)",{exact:true}).fill("0");
  await page.getByRole("button",{name:"Save case",exact:true}).click();
  await expect(editor).toContainText("Saved Weekday host");
  await page.reload();
  await expect(page.getByLabel("Case name",{exact:true})).toHaveValue("Paid coverage");
  await page.getByLabel("Work on a case").selectOption({label:"Weekday host · v1"});
  await page.getByText("Site decision and joint downside",{exact:true}).click();
  await expect(page.getByLabel("Dispatch pool identifier")).toHaveValue("Example south peak");
  await expect(page.getByLabel("Residual charges per peak shift",{exact:true})).toHaveValue("0");
  await page.getByText("Additional network cash flows",{exact:true}).click();
  await expect(page.getByLabel("With site ($)",{exact:true})).toHaveValue("0");
  await expect(page.getByLabel("Without site ($)",{exact:true})).toHaveValue("500");
  await page.getByLabel("Compare with").selectOption({label:"Paid coverage · v1"});
  await expect(metric).toContainText("Compared");
  await expect(page.getByLabel("Host coverage hours per weekday",{exact:true})).toHaveValue("5");
  latest="bbbbbbbbbbbbbbbbbbbbbbbb";await page.reload();
  await expect(editor).toContainText("Site evidence or model changed");
  await expect(page.getByRole("button",{name:"Save case",exact:true})).toBeDisabled();
  expect(await editor.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
});

test("open released charging assumptions from the portfolio",async({page})=>{
  test.skip(process.env.MAP_PRODUCTION_CHECK!=="1","Read-only release check.");
  const response=await page.request.get("/api/data/selection-review");
  expect(response.ok()).toBeTruthy();
  const {rows}=await response.json() as {rows:SelectionRow[]};
  const record=rows.find(r=>r.charging?.selected && r.financeVisible)??rows.find(r=>r.charging && r.financeVisible);
  expect(Boolean(record)).toBeTruthy();
  const res=await page.request.get("/api/actions/charging?site="+encodeURIComponent(record!.id));
  expect(res.ok()).toBeTruthy();
  const data=await res.json();
  expect(data.site.deal_id===record!.id).toBe(true);
  const params=new URLSearchParams({view:"explain",site:record!.id});
  if(record!.charging?.selected)params.set("case",record!.charging.selected);
  await page.goto("/charging?"+params);
  if(record!.charging?.selected)await expect(page.getByLabel("Work on a case")).toHaveValue(record!.charging.selected);
  await expect(page.getByRole("region",{name:"Cost per charge explanation"})).toBeVisible();
  await expect(page.getByRole("region",{name:"Charging economics editor"})).toBeVisible();
});

test("explain a preliminary range with a conditional aisle on desktop and phone", async ({page}, info) => {
  const site = {deal_id:"PIPE-PHX-9997",name:"Example service lot",charging:{preliminary:{
    layouts:[{stalls:4,condition:"Parking with shared aisle access",build:40000,staffing:24000,upkeep:4000,
      base:{sessions:4000,upgrade:20000,annualCost:40600,perCharge:10.15},
      downside:{sessions:3000,upgrade:30000,annualCost:41700,perCharge:13.90}}],
    space:"0 spaces",price:100000,terms:"purchase",priceBasis:"Workbook property ask",cash:5000,
    cashBasis:"Workbook retained annual cash",years:10,closing:.1,capital:0,tax:.01}}};
  await page.route("**/api/actions/charging?site=*",route=>route.fulfill({json:{site,history:[],source:"sample",canWrite:false}}));
  await page.goto("/charging?site="+site.deal_id+"&view=explain");
  const panel=page.getByRole("region",{name:"Preliminary site cost"});
  await expect(panel).toContainText("$10.15–$13.90");
  await expect(panel).toContainText("shared aisle access");
  await panel.getByText("How this range was calculated").click();
  await expect(panel).toContainText("4,000 annual charges");
  await expect(panel).toContainText("25% fewer");
  expect(await panel.evaluate(el=>el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await mkdir("review-shots",{recursive:true});
  await panel.screenshot({path:"review-shots/"+info.project.name+"-preliminary-charging.png"});
});

test("open released charging ranges from the Phoenix list",async({page},info)=>{
  test.skip(process.env.MAP_PRODUCTION_CHECK!=="1" && process.env.MAP_DEPLOYED_PREVIEW!=="1","Requires a deployed build.");
  const response=await page.request.get("/api/data/deals");
  expect(response.ok()).toBe(true);
  const {features}=await response.json() as {features:{properties:import("../lib/types").DealProps}[]};
  const byId=new Map(features.map(f=>[f.properties.deal_id,f.properties]));
  await page.goto("/?funnel=pipeline&view=list&city=PHX&pstage=all");
  const list=page.getByTestId("pipeline-list");
  const rows=list.locator(info.project.name==="mobile" ? "li[data-site-row]" : "tbody tr[data-site-row]");
  await expect(rows.first()).toBeVisible();
  const ids=await rows.evaluateAll(elements=>elements.map(row=>row.getAttribute("data-site-row")!));
  const deals=ids.map(id=>byId.get(id));
  expect(deals.every(Boolean)).toBe(true);
  const counts={priced:0,needsLayout:0,needsTerms:0,inactiveOrOutsideScope:0,other:0};
  for (const d of deals) {
    const c=d!.charging, p=c?.preliminary;
    if (!c) counts.inactiveOrOutsideScope++;
    else if (c.stale) counts.other++;
    else if (c.result.siteCost!=null || (p && "layouts" in p)) counts.priced++;
    else if (p && "reason" in p && /footprint|layout|spaces fit|measure|image|aisle|parcel|outline|bay/i.test(p.reason)) counts.needsLayout++;
    else if (p && "reason" in p && /terms|rent|available|price|rights|lease|availability/i.test(p.reason)) counts.needsTerms++;
    else counts.other++;
  }
  console.info("Phoenix charging coverage", JSON.stringify({visible:ids.length,...counts}));
  const sampled=deals.find(d=>d?.charging?.preliminary && "layouts" in d.charging.preliminary && !d.charging.stale && d.charging.result.siteCost==null);
  if (process.env.MAP_PRODUCTION_CHECK==="1") expect(Boolean(sampled)).toBe(true);
  if (!sampled) return;
  const label=pipelineCost(sampled.charging).value;
  const index=ids.indexOf(sampled.deal_id);
  expect((await rows.nth(index).textContent())?.includes(label)).toBe(true);
  await page.goto("/charging?site="+encodeURIComponent(sampled.deal_id)+"&view=explain");
  const panel=page.getByRole("region",{name:"Preliminary site cost"});
  expect((await panel.textContent())?.includes(label)).toBe(true);
});
