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
  inputs.evidence.conversion={status:"quoted",source:"Synthetic contractor quote",date:"2026-11-01"};
  await page.goto(url+"&view=explain&case="+original.id+"%3A1");
  const explanation=page.getByRole("region",{name:"Cost per charge explanation"});
  await expect(explanation).toBeVisible();
  await explanation.getByText("Annual costs and retained cash",{exact:true}).click();
  await explanation.getByText("Construction and interruption",{exact:true}).click();
  await explanation.getByRole("button",{name:"Additional conversion works ($ once)",exact:true}).click();
  await expect(explanation).toContainText("Synthetic contractor quote");
  await explanation.getByLabel("Trial value").fill("72000");
  await explanation.getByRole("button",{name:"Apply trial"}).click();
  await expect(explanation).toContainText("Scenario override");
  await expect(explanation).toContainText("Before trial");
  await page.getByLabel("Case name",{exact:true}).fill("Trial conversion");
  await page.getByRole("button",{name:"Save named alternative"}).click();
  await expect(page.getByRole("status")).toContainText("Saved Trial conversion");
  expect(history.find(r=>r.selected)?.name).toBe("Paid coverage");
  await page.reload();
  await expect(page.getByLabel("Case name",{exact:true})).toHaveValue("Trial conversion");
  await explanation.getByLabel("Inspect an input or try a change").selectOption("conversion");
  await expect(explanation).toContainText("Synthetic contractor quote");
  await explanation.getByRole("button",{name:"Review source and date"}).click();
  await expect(page.getByLabel("Recorded source value")).toHaveValue("0");
  await page.getByRole("button",{name:"Explanation",exact:true}).click();
  await explanation.getByText("What limits completed charges?",{exact:true}).click();
  expect(await explanation.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await mkdir("review-shots",{recursive:true});
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
  await page.getByRole("button",{name:"Save case",exact:true}).click();
  await expect(editor).toContainText("Saved Weekday host");
  await page.reload();
  await expect(page.getByLabel("Case name",{exact:true})).toHaveValue("Paid coverage");
  await page.getByLabel("Work on a case").selectOption({label:"Weekday host · v1"});
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
  const record=rows.find(r=>r.charging && r.financeVisible);
  expect(Boolean(record)).toBeTruthy();
  const res=await page.request.get("/api/actions/charging?site="+encodeURIComponent(record!.id));
  expect(res.ok()).toBeTruthy();
  const data=await res.json();
  expect(data.site.deal_id===record!.id).toBe(true);
  await page.goto("/charging?view=explain&site="+encodeURIComponent(record!.id));
  await expect(page.getByRole("region",{name:"Cost per charge explanation"})).toBeVisible();
  await expect(page.getByRole("region",{name:"Charging economics editor"})).toBeVisible();
});
