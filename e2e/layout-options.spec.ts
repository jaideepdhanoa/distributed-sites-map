import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("compare operating layouts and model a four-stall boundary", async ({ page }, info) => {
  const sample = { summary:"Two working canopy rows border the circulation loop.",status:"reviewed",recorded:0,baseline:"recorded",segment:"Wash",cohort:"active",revision:"abcdef012345",
    zones:[{kind:"vacuum",label:"Canopy row",points:[[23,40],[63,40],[63,50],[23,50]]},{kind:"clear",label:"Exit lane",points:[[68,29],[76,29],[76,70],[68,70]]}],
    image:{id:"1234567890abcdef",src:"/layout-test-aerial",source:"Illustrative site plan",date:"",width:400,height:260}};
  const drawing='<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260"><rect width="400" height="260" fill="#586452"/><rect x="58" y="40" width="260" height="165" fill="#777771" stroke="#e0ca51" stroke-width="3"/><path d="M82 77h170v15H82zM85 104h174v22H85zM86 147h166v29H86z" fill="#cad2c6"/></svg>';
  await page.route("**/layout-test-aerial",r=>r.fulfill({contentType:"image/svg+xml",body:drawing}));
  await page.route("**/api/data/space-options?*",r=>r.fulfill({json:{assessment:{row:sample,reviewedOn:"2026-11-01"}}}));
  await page.route("**/api/actions/status",route=>route.fulfill({json:{enabled:true,actionRole:"contributor",username:"reviewer"}}));
  await page.route("**/api/actions/notes?*",route=>route.fulfill({json:{notes:[]}}));
  const response=await page.request.get("/api/data/deals");
  expect(response.ok()).toBeTruthy();
  const deals=await response.json();
  const id=deals.features.find((f: {properties:{kind:string;city:string;stage_group:string}})=>f.properties.kind==="pipeline" && f.properties.city==="PHX" && f.properties.stage_group==="desk").properties.deal_id;
  await page.goto("/?"+new URLSearchParams({site:id,city:"PHX",funnel:"pipeline",panel:"space-options",sheet:"full"}));
  const panel=page.getByTestId("space-options");
  await expect(panel.getByRole("button",{name:"Convert outdoor space",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(panel).toContainText("0 stalls in the earlier screen");
  await panel.getByRole("button",{name:"Convert bays",exact:true}).click();
  await expect(panel).toContainText("No bay footprint established");
  await panel.getByRole("button",{name:"Convert outdoor space",exact:true}).click();
  await mkdir("review-shots",{recursive:true});
  await panel.screenshot({path:"review-shots/"+info.project.name+"-space-options.png",animations:"disabled"});
  await panel.getByRole("button",{name:"Adjust outline"}).click();
  const handle = panel.locator('svg circle[fill="transparent"]').first();
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width / 2, y = box!.y + box!.height / 2;
  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x+12,y+6,{steps:3});
  await page.mouse.up();
  await expect(panel.getByLabel("Horizontal %")).not.toHaveValue("23");
  await expect(panel.getByRole("button",{name:"Save outline"})).toBeEnabled();
  await panel.screenshot({path:"review-shots/"+info.project.name+"-edit-outline.png",animations:"disabled"});
  await panel.getByRole("button",{name:"Cancel",exact:true}).click();
  await panel.getByRole("button",{name:"Comment",exact:true}).click();
  await expect(panel.getByPlaceholder("Comment or @mention…")).toBeVisible();
  await panel.getByRole("button",{name:"Comment",exact:true,expanded:true}).click();
  await panel.getByRole("button",{name:"Test fit and economics"}).click();
  await panel.getByLabel("Net row length (ft)",{exact:true}).fill("40");
  await panel.getByLabel("Net depth including aisle (ft)",{exact:true}).fill("44");
  await panel.getByLabel("Possible clearance loss per dimension (ft)",{exact:true}).fill("5");
  await expect(panel).toContainText("0–4 stalls");
  expect(await panel.evaluate(el=>el.scrollWidth <= el.clientWidth)).toBeTruthy();
});

test("find a bay review in the portfolio, including a site without a map pin", async ({ page }) => {
  const sample = { id:"PIPE-PHX-9999", mapped:false, city:"PHX", name:"Example repair business", stage:"Assessment cohort", cohort:"active", focus:"Test a conversion", baseline:"No recorded stall count", options:["bays"], kinds:["Service or wash bay"], finding:"Service building", next:"Obtain an interior service plan." };
  await page.route("**/api/data/space-options?view=portfolio", r=>r.fulfill({ json:{ rows:[sample] } }));
  await page.route("**/api/data/space-options?site=*", r=>r.fulfill({ json:{ assessment:null } }));
  await page.goto("/space-review");
  await page.getByLabel("Layout with an outline").selectOption("outdoor");
  await expect(page.getByText("No sites match these filters.")).toBeVisible();
  await page.getByLabel("Layout with an outline").selectOption("bays");
  await page.getByRole("link",{name:"Example repair business"}).click();
  await expect(page.getByRole("heading",{name:"Example repair business"})).toBeVisible();
  await expect(page.getByTestId("space-options")).toContainText("No aerial assessment on file");
});
