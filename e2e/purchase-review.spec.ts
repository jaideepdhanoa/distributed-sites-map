import { test, expect } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { example } from "../tests/fixtures/purchase-review";
import { isExcludedSite } from "../lib/alerts/excluded";
import type { DealProps } from "../lib/types";

test("inspect acquisition evidence and switch the operating case", async ({page}, info) => {
  const deals = await page.request.get("/api/data/deals");
  expect(deals.ok()).toBeTruthy();
  const payload = await deals.json();
  const record = payload.features.find((f:{properties:DealProps}) =>
    f.properties.kind==="pipeline" && f.properties.stage_group!=="dropped" &&
    f.properties.financials_open!==false && !isExcludedSite(f.properties.deal_id));
  expect(Boolean(record)).toBeTruthy();
  const id = record.properties.deal_id;
  Object.assign(record.properties, {
    selectionResearch:{reviewedOn:"2026-01-01",priority:"Check parking rights",check:"Read the exclusive-use exhibit.",scope:"Example property",quote:null,basis:"Price unresolved",note:"No released bay.",source:null,cases:[]},
    name:"Example operating site", asking_price:example.inputs.ask, purchase:example,
    figures_status:"shown", financials_open:true, statementCoverage:"empty", figures_source:"",
    earnings_period:"", earnings_basis:"", stated_cash_flow:null, cash_flow_label:"",
  });
  await page.route("**/api/data/deals",r=>r.fulfill({json:payload}));
  await page.route("**/api/data/financials/"+id,r=>r.fulfill({json:{open:false,pnl:null}}));
  await page.goto("/?city="+id.split("-")[1]+"&funnel=pipeline&site="+id+"&sheet=full");
  await page.getByRole("tab",{name:"Financials",exact:true}).click();
  const panel=page.getByTestId("purchase-review");
  await expect(panel.locator(".purchase-lead")).toContainText("$45,000");
  await expect(panel.locator(".purchase-funding")).toContainText("$43,000");
  await expect(panel.locator(".purchase-check")).toContainText("Reconcile earnings basis");
  await mkdir("review-shots",{recursive:true});
  const prefix=process.env.MAP_DEPLOYED_PREVIEW ? "deployed-" : "";
  // Only the substituted model and its context appear in the artifact.
  await panel.locator(".purchase-summary").screenshot({path:"review-shots/"+info.project.name+"-"+prefix+"financial-purchase.png",animations:"disabled"});
  await panel.getByText("Offering and downside",{exact:false}).click();
  await expect(panel.getByText("Read the exclusive-use exhibit.")).toBeVisible();
  await expect(panel.getByText("Unpriced",{exact:true})).toBeVisible();
  await panel.getByRole("button",{name:"Workbook input"}).click();
  await expect(panel.locator(".purchase-lead")).toContainText("$65,000");
  await panel.getByText("Test a layout or operating change",{exact:true}).click();
  await panel.getByLabel("Annual contribution displaced ($)",{exact:true}).fill("5000");
  await expect(panel.locator(".purchase-lead")).toContainText("$60,000");
  await page.reload();
  await expect(page.getByRole("tab",{name:"Financials",exact:true})).toHaveAttribute("aria-selected","true");
  expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
});

test("open released financials without changing a record",async({page})=>{
  test.skip(process.env.MAP_PRODUCTION_CHECK!=="1","Runs against the release.");
  const response=await page.request.get("/api/data/deals");
  expect(response.ok()).toBeTruthy();
  const payload=await response.json();
  const operating=payload.features.filter((f:{properties:DealProps})=>f.properties.kind==="pipeline" &&
    f.properties.financials_open!==false && f.properties.stage_group!=="dropped" && !isExcludedSite(f.properties.deal_id));
  const row=operating.find((f:{properties:DealProps})=>f.properties.purchase?.inputs.cash!=null) || operating[0];
  expect(Boolean(row)).toBeTruthy();
  const id=row.properties.deal_id;
  await page.goto("/?city="+id.split("-")[1]+"&funnel=pipeline&site="+id+"&panel=purchase&sheet=full");
  const panel=page.getByTestId("purchase-review");
  await expect(panel).toBeVisible();
  if (row.properties.purchase?.inputs.cash!=null) {
    if (row.properties.purchase.inputs.normalized!=null) await panel.getByRole("button",{name:"Workbook input"}).click();
    const expected=new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0})
      .format(row.properties.purchase.inputs.cash);
    // Keep site amounts out of public CI diagnostics.
    expect((await panel.locator(".purchase-lead strong").innerText())===expected).toBe(true);
  }
  await expect(page.getByRole("tab",{name:"Financials",exact:true})).toHaveAttribute("aria-selected","true");
});

test("compare an adjusted purchase against a common baseline and restore the selected cases", async({page},info)=>{
  const response=await page.request.get("/api/data/deals");
  const data=await response.json();
  const records=data.features.filter((f:{properties:DealProps})=>f.properties.kind==="pipeline" && !isExcludedSite(f.properties.deal_id)).slice(0,2);
  expect(records).toHaveLength(2);
  for (const [i,record] of records.entries()) Object.assign(record.properties,{name:"Example business "+(i+1),
    financials_open:true,figures_status:"shown",purchase:example,stage_group:"desk",selectionResearch:undefined});
  await page.route("**/api/data/deals",r=>r.fulfill({json:{...data,features:records}}));
  const ids=records.map((record:{properties:DealProps})=>record.properties.deal_id);
  await page.goto("/?"+new URLSearchParams({funnel:"pipeline",city:"all",view:"list",compare:ids.join("|")}));
  const tray=page.getByTestId("compare-tray");
  const row=tray.locator('[data-compare-row="Retained annual cash"]');
  await row.getByRole("button").first().click();
  const panel=page.getByTestId("purchase-review");
  await panel.getByText("Test a layout or operating change",{exact:true}).click();
  await panel.getByLabel("Annual contribution displaced ($)",{exact:true}).fill("5000");
  await page.getByRole("button",{name:/Back to comparison/}).click();
  await expect(row).toHaveAttribute("data-state","basis");
  await expect(row).toContainText("$5,000/yr displaced");
  await expect(row).toContainText("$40,000");
  const downloadPromise = page.waitForEvent("download");
  await tray.getByRole("button",{name:"Download dated snapshot"}).click();
  const download = await downloadPromise;
  const csv = await readFile((await download.path())!,"utf8");
  const exportedCash = csv.split("\r\n").find(line=>line.includes("Retained annual cash")) || "";
  expect(exportedCash.includes("$40,000") && exportedCash.includes("$5,000/yr displaced")).toBe(true);
  await row.scrollIntoViewIfNeeded();
  const heading=row.getByRole("rowheader");
  expect(await heading.evaluate(el=>el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await mkdir("review-shots",{recursive:true});
  await row.screenshot({path:"review-shots/"+info.project.name+"-"+(process.env.MAP_DEPLOYED_PREVIEW?"deployed-":"")+"compared-cases.png"});
  const base=tray.getByLabel("Use workbook baseline for all sites");
  await base.check();
  await expect(row).toHaveAttribute("data-state","shared");
  await expect(row.getByRole("button").first()).toContainText("$65,000");
  await base.uncheck();
  await expect(row).toContainText("$40,000");
});
