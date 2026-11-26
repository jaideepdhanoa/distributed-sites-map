import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("compare operating layouts and model a four-stall boundary", async ({ page }, info) => {
  const sample = { summary:"Two working canopy rows border the circulation loop.",status:"reviewed",recorded:0,baseline:"recorded",segment:"Wash",cohort:"active",revision:"abcdef012345",
    zones:[{kind:"vacuum",label:"Canopy row",points:[[23,40],[63,40],[63,50],[23,50]]},{kind:"clear",label:"Exit lane",points:[[68,29],[76,29],[76,70],[68,70]]}],
    image:{id:"1234567890abcdef",src:"/layout-test-aerial",source:"Illustrative site plan",date:"",width:400,height:260}};
  const drawing='<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260"><rect width="400" height="260" fill="#586452"/><rect x="58" y="40" width="260" height="165" fill="#777771" stroke="#e0ca51" stroke-width="3"/><path d="M82 77h170v15H82zM85 104h174v22H85zM86 147h166v29H86z" fill="#cad2c6"/></svg>';
  await page.route("**/layout-test-aerial",r=>r.fulfill({contentType:"image/svg+xml",body:drawing}));
  await page.route("**/api/data/space-options?site=*",r=>r.fulfill({json:{assessment:{row:sample,reviewedOn:"2026-11-01"}}}));
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

test("open a released outline and discussion without writing to the site", async ({ page }) => {
  test.skip(process.env.MAP_PRODUCTION_CHECK !== "1", "Requires the published assessments.");
  const response = await page.request.get("/api/data/space-options?view=portfolio");
  expect(response.ok()).toBeTruthy();
  const { rows } = await response.json();
  const candidates = rows.filter((r: { options: string[] }) => r.options.includes("outdoor"));
  const target = candidates.find((r: { mapped: boolean }) => !r.mapped) || candidates[0];
  expect(Boolean(target)).toBeTruthy();
  const status = await (await page.request.get("/api/actions/status")).json();
  let attemptedWrite = false;
  await page.route(/\/api\/(changes|actions\/notes)(\?|$)/, async route => {
    if (route.request().method() === "GET") return route.continue();
    attemptedWrite = true;
    return route.abort();
  });
  await page.goto("/space-review?"+new URLSearchParams({site:target.id,panel:"space-options"}));
  const panel = page.getByTestId("space-options");
  await panel.getByRole("button", {name:"Convert outdoor space",exact:true}).click();
  const thread = panel.getByRole("button", {name:"Comment",exact:true,expanded:false});
  await expect(thread).toBeVisible();
  if (status.enabled && ["contributor","reviewer"].includes(status.actionRole)) {
    await panel.getByRole("button",{name:"Adjust outline"}).click();
    await expect(panel.getByRole("button",{name:"Save outline"})).toBeDisabled();
    await panel.getByRole("button",{name:"Cancel",exact:true}).click();
  }
  await thread.click();
  await expect(panel.getByRole("button", {name:"Comment",exact:true,expanded:true})).toBeVisible();
  expect(attemptedWrite).toBe(false);
});

test("open an analyzed space on the main map and adjust a source-plan corner", async ({ page }, info) => {
  const id = "PIPE-PHX-9999";
  const frame = {id:"1234567890abcdef", source:"Example site plan", date:"", kind:"site-plan"};
  const zone = {kind:"parking", label:"East parking row", points:[[15,30],[68,30],[68,54],[15,54]],edited:false};
  const site = {id,name:"Example service site",market:"PHX",cohort:"active",revision:"abcdef012345",frame,center:null,zones:[zone]};
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260"><rect width="400" height="260" fill="#bbc5ab"/><path d="M32 38h320v175H32z" fill="#787c75"/><path d="M60 75h214v72H60z" fill="none" stroke="#f6edbd"/><path d="M91 76v70m31-70v70m31-70v70m31-70v70m31-70v70m31-70v70" stroke="#f6edbd"/></svg>';
  await page.route("**/layout-example.svg",r=>r.fulfill({contentType:"image/svg+xml",body:svg}));
  await page.route("**/api/data/space-options?view=map",r=>r.fulfill({json:{reviewsAvailable:true,sites:[site]}}));
  await page.route("**/api/data/space-options?site=*",r=>r.fulfill({json:{assessment:{row:{zones:[zone],revision:site.revision,image:{...frame,src:"/layout-example.svg",width:400,height:260}}}}}));
  await page.route("**/api/actions/status",r=>r.fulfill({json:{enabled:true,actionRole:"contributor",username:"reviewer"}}));
  await page.goto("/?spaces=1");
  const work = page.getByTestId("map-spaces-workspace");
  await work.getByRole("button",{name:/Example service site/}).click();
  await expect(work).toContainText("Analysis proposal");
  await expect(work).toContainText("Stall fit unresolved");
  await work.getByRole("button",{name:"Convert bays",exact:true}).click();
  await expect(work).toContainText("No bay footprint established");
  await work.getByRole("button",{name:"Convert outdoor space",exact:true}).click();
  await work.getByRole("button",{name:"Hide overlays"}).click();
  await expect(work.locator("svg polygon")).toHaveCount(0);
  await work.getByRole("button",{name:"Show overlays"}).click();
  await work.getByRole("button",{name:"Edit outline"}).click();
  await work.getByText("Corner coordinates").click();
  await work.getByLabel("Horizontal %").fill("16");
  await expect(work.getByRole("button",{name:"Save outline"})).toBeEnabled();
  await work.getByText("Corner coordinates").click();
  await mkdir("review-shots",{recursive:true});
  await page.screenshot({path:"review-shots/"+info.project.name+"-main-map-spaces.png",animations:"disabled"});
  await work.getByRole("button",{name:"Browse spaces"}).click();
  await expect(work.getByRole("alert")).toContainText("Discard your unsaved corners?");
  await work.getByRole("button",{name:"Discard edit"}).click();
  await expect(work.getByLabel("Find a site or space")).toBeVisible();
});

test("open a released outline in the main map on both source types", async ({page})=>{
  test.skip(process.env.MAP_PRODUCTION_CHECK !== "1","Requires the published inventory.");
  const response = await page.request.get("/api/data/space-options?view=map");
  expect(response.ok()).toBeTruthy();
  const catalog = await response.json() as import("../lib/spaces/mapCatalog").SpaceCatalog;
  expect(catalog.reviewsAvailable).toBe(true);
  const active=catalog.sites.filter(s=>s.cohort==="active");
  const count=(rows:typeof active)=>rows.reduce((n,s)=>n+s.zones.filter(z=>z.kind!=="clear").length,0);
  console.log("Active spaces:",count(active),"sites:",active.length,"aligned:",count(active.filter(s=>s.frame.bounds)),
    "team-adjusted outlines across inventory:",catalog.sites.reduce((n,s)=>n+s.zones.filter(z=>z.edited).length,0));
  let writes=0;
  await page.route(/\/api\/(changes|actions\/notes)(\?|$)/,r=>{
    if(r.request().method()==="GET") return r.continue();
    writes++; return r.abort();
  });
  const status=await (await page.request.get("/api/actions/status")).json();
  for(const aligned of [true,false]){
    const site=active.find(s=>Boolean(s.frame.bounds)===aligned);
    expect(Boolean(site)).toBe(true);
    await page.goto("/?"+new URLSearchParams({spaces:"1",spaceSite:site!.id}));
    const work=page.getByTestId("map-spaces-workspace");
    await expect(work.getByTestId("map-space-title")).toBeVisible();
    if(aligned){
      await page.waitForFunction(()=>Boolean((window as unknown as {__sitesMap?:import("maplibre-gl").Map}).__sitesMap?.getSource("space-evidence-image")));
    }else await expect(work.locator("svg[role=img] image")).toBeVisible();
    if(status.enabled && ["contributor","reviewer"].includes(status.actionRole)){
      await work.getByRole("button",{name:"Edit outline"}).click();
      await expect(work.getByRole("button",{name:"Save outline"})).toBeDisabled();
      await work.getByRole("button",{name:"Cancel edit"}).click();
    }
    await work.getByRole("button",{name:"Comment",exact:true}).click();
    await expect(work.getByRole("button",{name:"Comment",exact:true,expanded:true})).toBeVisible();
  }
  expect(writes).toBe(0);
});
