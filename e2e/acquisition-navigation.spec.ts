import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import type { Map as SiteMap } from "maplibre-gl";
import { acquisitionShortlist } from "../lib/reviewNavigation";

const first = "PIPE-PHX-9001";
const other = "PIPE-LAS-9002";
const primary = {route:"Operating acquisition",disposition:"Shortlist",rank:1,rationale:"Check the operating yard.",next:"Measure the service aisle.",
  reviewedOn:"2026-01-01",owner:"Reviewer (proposed)",revisitOn:"2026-01-12",evidence:"https://example.org/review",offering:null};
const visitPlan = {decision:"Confirm access",reason:"Outdoor stalls do not fit. Test whether a service bay can be converted.",
  beforeVisit:"Confirm access during peak hours.", commercial:"Confirm current earnings.", power:"Ask for a service reading.",
  fieldwork:"Measure the aisle.",scenario:"Compare the layouts.",basis:"Illustrative inputs.",beforeLoi:"Confirm the property rights."};
const review = {name:"Example service yard", primary, alternatives:[], visitPlan};
const sites = [{id:first,city:"PHX",name:review.name},{id:other,city:"LAS",name:"Example repair shop"}];

async function fixtures(page: Page) {
  await page.route("https://tiles.openfreemap.org/styles/positron", route=>route.fulfill({json:{
    version:8, glyphs:"https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",sources:{},layers:[{id:"background",type:"background",paint:{"background-color":"#eceee6"}}]}}));
  await page.route("https://demotiles.maplibre.org/**",route=>route.fulfill({contentType:"application/x-protobuf",body:""}));
  const frame = {id:"1234567890abcdef",source:"Illustrative plan",width:400,height:260,kind:"site-plan",date:"",bounds:[-112.01,33.41,-112.00,33.40]};
  const zones = [{kind:"parking",label:"Test row",points:[[12,20],[52,20],[52,40],[12,40]]}];
  await page.route("**/api/data/space-options?view=map",route=>route.fulfill({json:{reviewsAvailable:true,sites:sites.map(s=>({
    ...s,market:s.city,center:s.city==="PHX"?[-112.005,33.405]:[-115.16,36.15],cohort:"active",revision:"abcdef012345",frame,zones
  }))}}));
  await page.route("**/api/data/space-options?site=*",route=>route.fulfill({json:{assessment:{reviewedOn:"2026-01-01",row:{
    revision:"abcdef012345",baseline:"recorded",recorded:4,image:{...frame,src:"/example-layout.svg"},zones
  }}}}));
  await page.route("**/example-layout.svg",route=>route.fulfill({contentType:"image/svg+xml",body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260"><rect width="400" height="260" fill="#a3afa2"/></svg>'}));
  await page.route("**/api/data/deals",route=>route.fulfill({json:{type:"FeatureCollection",features:sites.map(s=>({
    type:"Feature", geometry:{type:"Point",coordinates:s.city==="PHX"?[-112.005,33.405]:[-115.16,36.15]},
    properties:{deal_id:s.id,kind:"pipeline",city:s.city,name:s.name,address:"Example parcel",business_type:"Car Wash",
      stage:"Financial screen",stage_group:"financial",service_area_class:"Inside",opportunityReview:review}
  }))}}));
  await page.route("**/api/data/selection-review",route=>route.fulfill({json:{hasInputs:true,mismatches:0,rows:sites.map((s,i)=>({
    ...s,stage:"Financial screen",priority:"Check space",section:"Operating",review:{...review,primary:{...primary,rank:i+1}}
  }))}}));
}

test("reach the all-market shortlist from home and keyboard search", async ({page})=>{
  await fixtures(page);
  await page.goto("/?city=PHX&funnel=pipeline&view=list");
  const nav=page.getByRole("navigation",{name:"Acquisition workspace"});
  await expect(page.getByRole("heading",{name:"Phoenix pipeline"})).toBeVisible();
  await nav.getByRole("link",{name:"Acquisition shortlist"}).click();
  await expect(page).toHaveURL(url=>url.pathname+url.search===acquisitionShortlist);
  await expect(page.getByRole("heading", {name:"Example repair shop"})).toBeVisible();
  await page.goto(acquisitionShortlist+"&scope="+first);
  await expect(page.getByText("Limited to the sites from your pipeline list.",{exact:false})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Example repair shop"})).toHaveCount(0);
  await page.getByRole("button",{name:"Show all active sites"}).click();
  await expect(page.getByRole("heading",{name:"Example repair shop"})).toBeVisible();
  await page.goto("/?city=PHX&funnel=pipeline&view=list");
  await page.getByTestId("scope-search").filter({visible:true}).click();
  const query=page.getByRole("textbox",{name:"Search everything"});
  await query.fill("shortlist"); await query.press("Enter");
  await expect(page).toHaveURL(url=>url.pathname+url.search===acquisitionShortlist);
});

test("open a scoped Spaces catalog and restore the original map camera",async({page})=>{
  await fixtures(page);
  await page.goto("/?funnel=pipeline&city=PHX");
  const mapReady=()=>page.waitForFunction(()=>Boolean((window as Window & {__sitesMap?:SiteMap}).__sitesMap?.getLayer("sites")));
  await mapReady();
  await page.getByRole("button",{name:"Zoom in",exact:true}).click();
  const camera=()=>page.evaluate(()=>{
    const m=(window as unknown as Window & {__sitesMap:SiteMap}).__sitesMap;
    return m ? [...m.getCenter().toArray(),m.getZoom()].map(x=>Number(x.toFixed(3))) : null;
  });
  await page.waitForFunction(()=>!(window as unknown as Window & {__sitesMap:SiteMap}).__sitesMap.isMoving());
  const before=await camera();
  const nearby=page.getByRole("button",{name:/^Nearby sites/});
  await expect(nearby).toBeVisible();
  const spaces=page.getByRole("group",{name:"Map tools"}).getByRole("button",{name:"Spaces"});
  const [nearRect,spaceRect]=await Promise.all([nearby.boundingBox(),spaces.boundingBox()]);
  expect(nearRect && spaceRect && (
    nearRect.x + nearRect.width <= spaceRect.x || spaceRect.x + spaceRect.width <= nearRect.x ||
    nearRect.y + nearRect.height <= spaceRect.y || spaceRect.y + spaceRect.height <= nearRect.y
  )).toBe(true);
  await expect(nearby).toHaveAttribute("aria-expanded",String((page.viewportSize()?.width ?? 0) >= 768));
  await spaces.click();
  await expect(page.getByText("1 space across 1 site")).toBeVisible();
  await page.getByRole("button",{name:"Browse all analyzed sites"}).click();
  await expect(page.getByText("2 spaces across 2 sites")).toBeVisible();
  await page.getByRole("button",{name:/^Example repair shop/}).click();
  await page.getByRole("button",{name:"Browse spaces"}).click();
  await expect(page.getByText("2 spaces across 2 sites")).toBeVisible();
  await page.getByRole("button",{name:"Main map"}).click();
  await mapReady();
  await expect.poll(camera).toEqual(before);
  await expect(page).toHaveURL(url=>url.searchParams.get("city")==="PHX" && !url.searchParams.has("spaces"));
});

test("read the action and open the bounded site-fit thumbnail",async({page},info)=>{
  await fixtures(page);
  await page.goto("/?city=PHX&funnel=pipeline&sheet=full&site="+first);
  const drawer=page.locator("aside.drawer");
  await expect(drawer.getByRole("tab",{name:"Site fit"})).toBeInViewport();
  const brief=drawer.locator(".acquisition-brief");
  await expect(brief).toContainText("Acquisition priority #1");
  await expect(brief).toContainText(visitPlan.beforeVisit);
  await expect(drawer.getByText("Cost per charge", {exact:true}).first()).toBeVisible();
  await expect(drawer.getByText("Charging spaces", {exact:true}).first()).toBeVisible();
  await mkdir("review-shots",{recursive:true});
  await brief.screenshot({path:"review-shots/"+info.project.name+"-acquisition-brief.png"});
  await drawer.getByRole("tab",{name:"Site fit"}).click();
  const thumb=drawer.locator(".space-thumb");
  await expect(thumb).toBeVisible();
  const size=await thumb.evaluate(el=>[el.getBoundingClientRect().height,el.querySelector("svg")!.getBoundingClientRect().height]);
  expect(size[1]).toBeLessThanOrEqual(size[0]+1);
  await drawer.getByRole("button",{name:"Open annotated layout"}).click();
  await expect(drawer.getByRole("button",{name:"Convert outdoor space",exact:true})).toBeVisible();
});

test("open the scoped inventory if a map style is unavailable",async({page})=>{
  await fixtures(page);
  await page.route("https://tiles.openfreemap.org/styles/positron",route=>route.abort());
  await page.goto("/?city=PHX&funnel=pipeline");
  const fallback=page.getByRole("status").filter({hasText:"Map unavailable"});
  await fallback.getByRole("button",{name:"Spaces"}).click();
  await expect(page.getByText("1 space across 1 site")).toBeVisible();
  await page.getByRole("button",{name:"Main map"}).click();
  await expect(fallback.getByRole("button",{name:"Retry map"})).toBeVisible();
});
