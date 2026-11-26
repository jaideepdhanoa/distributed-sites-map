import { isExcludedSite } from "../lib/alerts/excluded";
import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import type { GeoJSONSource, Map as SiteMap } from "maplibre-gl";

type MapWindow = Window & { __sitesMap: SiteMap };

async function camera(page: Page) {
  return page.evaluate(() => {
    const map = (window as unknown as MapWindow).__sitesMap;
    return [...map.getCenter().toArray(), map.getZoom()].map(value => Number(value.toFixed(3)));
  });
}

// Read rendered features for hit testing. Every camera movement in the journey uses a visible control.
async function visiblePins(page: Page) {
  return page.evaluate(() => {
    const map = (window as unknown as MapWindow).__sitesMap;
    const canvas = map.getCanvas();
    const box = canvas.getBoundingClientRect();
    return map.queryRenderedFeatures({ layers: ["sites"] }).flatMap(feature => {
      if (feature.geometry.type !== "Point" || !feature.properties.site_id) return [];
      const [lng, lat] = feature.geometry.coordinates;
      const pt = map.project([lng, lat]);
      const x = box.left + pt.x, y = box.top + pt.y;
      if (document.elementFromPoint(x, y) !== canvas) return [];
      const layers = ["sites","pin-singles","offmarket","deals-pipe","focus-pin","clusters"].filter(id => map.getLayer(id));
      const hits = map.queryRenderedFeatures([Math.round(pt.x),Math.round(pt.y)],{layers});
      const id = String(feature.properties.site_id);
      if (!hits.length || hits.some(hit => (hit.properties.site_id || hit.properties.deal_id) !== id)) return [];
      return [{id,x,y}];
    });
  });
}

test("enter Phoenix by market label, compare nearby pins and return to the map", async ({ page }, info) => {
  const phone = info.project.name === "mobile";
  await page.goto("/?city=all&funnel=universe&stage=in_area");
  const market = page.getByRole("button", { name: /^Phoenix ·/ });
  await expect(market).toBeInViewport({ ratio: 1 });
  await page.waitForFunction(() => (window as unknown as MapWindow).__sitesMap?.loaded());
  const scope = page.locator(".workspace-scope:visible");
  if (!process.env.MAP_PRODUCTION_CHECK) {
    await mkdir("review-shots", { recursive: true });
    const prefix = process.env.MAP_DEPLOYED_PREVIEW ? "deployed-" : "";
    await page.screenshot({ path: `review-shots/${info.project.name}-${prefix}market-overview.png` });
  }
  await scope.click();
  await expect(market).toBeInViewport({ ratio: 1 });
  await expect(market).toBeVisible();
  await market.click();
  await expect(page).toHaveURL(/city=PHX/);
  await expect(page.locator(".stage-map")).toHaveAttribute("data-basemap", "positron");
  await page.waitForFunction(() => {
    const map = (window as unknown as MapWindow).__sitesMap;
    return map?.getLayer("sites") && map.isStyleLoaded() && !map.isMoving();
  });
  const zoomIn = page.locator(".maplibregl-ctrl-zoom-in");
  if (phone) await zoomIn.click({trial:true,timeout:5000});
  for (let i = 0; i < 4 && (await visiblePins(page)).length < 2; i++) {
    await zoomIn.click();
    await page.waitForFunction(() => !(window as unknown as MapWindow).__sitesMap.isMoving());
  }
  await expect.poll(async () => (await visiblePins(page)).length).toBeGreaterThan(1);
  const original = await camera(page);
  let previous: { id: string; x: number; y: number } | undefined;
  const ids: string[] = [];
  for (let i = 0; i < 2; i++) {
    await expect.poll(async () => (await visiblePins(page)).length).toBeGreaterThan(1);
    let pins = await visiblePins(page);
    if (previous) {
      const first = previous;
      pins = pins.filter(pin => pin.id !== first.id && Math.hypot(pin.x - first.x, pin.y - first.y) > 22)
        .sort((a, b) => Math.hypot(a.x - first.x, a.y - first.y) - Math.hypot(b.x - first.x, b.y - first.y));
    }
    const pin = pins[0];
    expect(pin).toBeTruthy();
    if (phone) await page.touchscreen.tap(pin.x, pin.y);
    else await page.mouse.click(pin.x, pin.y);
    const preview = page.locator(".map-preview");
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute("data-record",pin.id);
    const id = pin.id;
    expect(ids).not.toContain(id);
    ids.push(id!);
    previous = { ...pin, id: id! };
    await preview.getByRole("button", { name: "Add to comparison" }).click();
    await expect(preview).toHaveCount(0);
    await expect.poll(() => camera(page)).toEqual(original);
  }
  const tray = page.getByTestId("compare-tray");
  await expect(tray.getByRole("table")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("compare")?.split("|")).toEqual(ids);
  await tray.getByRole("button", { name: "Close compare" }).click();
  await expect.poll(() => camera(page)).toEqual(original);
  expect(new URL(page.url()).searchParams.get("stage")).toBe("in_area");
});

test("map failure immediately exposes the same shortlist and a retry preserves scope", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(this: HTMLCanvasElement, kind, ...args) {
      if ((kind === "webgl" || kind === "webgl2") && !sessionStorage.getItem("graphics-restored")) return null;
      return Reflect.apply(original, this, [kind, ...args]);
    } as typeof original;
  });
  await page.goto("/?city=PHX&funnel=pipeline&pstage=desk");
  const retry = page.getByRole("button", { name: "Retry map" });
  const list = page.getByTestId("pipeline-list");
  await expect(retry).toBeVisible();
  await expect(list).toBeVisible();
  const count = await page.locator(".workspace-scope:visible small").innerText();
  const scope = new URL(page.url()).search;
  await retry.click();
  await expect(retry).toBeVisible();
  await expect(list).toBeVisible();
  await expect(page.locator(".workspace-scope:visible small")).toHaveText(count);
  expect(new URL(page.url()).search).toBe(scope);
  const rows = list.locator("[data-site-row]");
  for (const index of [0, 1]) await rows.nth(index).getByRole("checkbox").check();
  await list.getByTestId("selection-bar").getByRole("button", { name: "Compare", exact: true }).click();
  const tray = page.getByTestId("compare-tray");
  await expect(tray.getByRole("table")).toBeVisible();
  await tray.getByRole("button", { name: "Close compare" }).click();
  await expect(retry).toBeVisible();
  const row = rows.first();
  const selected = await row.getAttribute("data-site-row");
  await row.locator("button.list-row, td[data-col=site]").first().click();
  await expect(page.locator("aside.drawer")).toHaveAttribute("data-record", selected!);
  await page.evaluate(() => sessionStorage.setItem("graphics-restored", "1"));
  await retry.click();
  await expect(retry).toHaveCount(0);
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await page.waitForFunction(() => (window as unknown as MapWindow).__sitesMap?.getLayer("sites") !== undefined);
  await expect(page.locator("aside.drawer")).toHaveAttribute("data-record", selected!);
  expect(new URL(page.url()).searchParams.get("pstage")).toBe("desk");
});


test("national mapped and missing counts reconcile with the shortlist", async ({ page }) => {
  const locations = [
    { city: "PHX", point: [-112.08, 33.45] }, { city: "LAS", point: [-115.15, 36.17] },
    { city: "MIA", point: [-80.19, 25.76] }, { city: "MIA", point: null },
  ];
  const features = locations.map(({ city, point }, index) => ({
    type: "Feature", geometry: point ? { type: "Point", coordinates: point } : null,
    properties: { site_id: city + "-QA-" + index, city, name: point ? "Test parcel " + index : "Map coverage example",
      origin: "universe", counts_as_site: true, in_area: true, land_only: false },
  }));
  await page.route(/\/api\/data\/sites(?:\?city=[A-Z]+)?$/, route => {
    const city = new URL(route.request().url()).searchParams.get("city");
    return route.fulfill({ json: { type: "FeatureCollection", features: features.filter(f => !city || f.properties.city === city) } });
  });
  await page.goto("/?city=all&funnel=universe&stage=in_area", { waitUntil: "domcontentloaded" });
  for (const market of ["Phoenix", "Las Vegas", "Miami"]) {
    await expect(page.getByRole("button", { name: market + " · 1", exact: true })).toBeVisible();
  }
  const coverage = page.locator(".shortlist-map-coverage:visible");
  await expect(coverage.locator("span")).toHaveText("3 mapped");
  await expect(page.locator(".workspace-scope:visible small")).toHaveText("4 sites");
  await coverage.getByRole("button", { name: "1 needs location" }).click();
  const dialog = page.getByRole("dialog", { name: "Needs location" });
  await expect(dialog.locator("li")).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: "Map coverage example" })).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "List", exact: true }).first().click();
  await expect(page.locator("[data-site-row=MIA-QA-3]")).toBeVisible();
});


test("the map key reflects the workspace and enabled layers", async ({ page }) => {
  await page.goto("/?city=PHX&funnel=pipeline&pstage=desk", { waitUntil: "domcontentloaded" });
  const key = page.getByRole("complementary", { name: "Key" });
  const open = key.getByRole("button", { name: "Map key" });
  await open.click();
  await expect(key.getByText("Desk screen", { exact: true })).toBeVisible();
  await expect(key.getByText("Cleared", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  const rings = page.getByRole("checkbox", { name: "Depot rings" });
  await rings.click();
  await expect(rings).toBeChecked();
  await page.getByRole("button", { name: "Close layers" }).click();
  if (await open.getAttribute("aria-expanded") !== "true") await open.click();
  await expect(key.getByText("Depot rings", { exact: true })).toBeVisible();
  await page.goto("/?city=PHX&funnel=universe&stage=in_area", { waitUntil: "domcontentloaded" });
  if (await open.getAttribute("aria-expanded") !== "true") await open.click();
  await expect(key.getByText("Cleared", { exact: true })).toBeVisible();
  await expect(key.getByText("Desk screen", { exact: true })).toHaveCount(0);
});

test("browse two nearby sites and keep the city camera", async ({ page }, info) => {
  await page.goto("/?city=PHX&funnel=universe&stage=in_area");
  const nearby = page.getByRole("complementary", { name: "Nearby sites" });
  const toggle = nearby.getByRole("button", { name: /Nearby sites/ });
  await expect(toggle).toBeVisible();
  await page.waitForFunction(() => {
    const map = (window as unknown as MapWindow).__sitesMap;
    return map?.getLayer("sites") && !map.isMoving();
  });
  const origin = await camera(page);
  const ids: string[] = [];
  for (let i = 0; i < 2; i++) {
    if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
    await expect(nearby.locator("[data-nearby-id]").nth(1)).toBeVisible();
    const first = nearby.locator("[data-nearby-id]").first();
    await expect(first.locator("small")).toHaveText(/.+/);
    if (!i && info.project.name === "desktop") {
      const ring = page.locator(".nearby-map-ring");
      await first.hover();
      await expect(ring).toBeVisible();
      await page.mouse.move(0, 0);
      await expect(ring).toHaveCount(0);
      await first.focus();
      await expect(ring).toBeVisible();
      await expect.poll(() => camera(page)).toEqual(origin);
    }
    if (!i && !process.env.MAP_PRODUCTION_CHECK) {
      await mkdir("review-shots", { recursive: true });
      const prefix = process.env.MAP_DEPLOYED_PREVIEW ? "deployed-" : "";
      await page.screenshot({ path: `review-shots/${info.project.name}-${prefix}nearby-sites.png` });
    }
    const row = nearby.locator("[data-nearby-id]").nth(i);
    const id = (await row.getAttribute("data-nearby-id"))!;
    ids.push(id);
    await row.click();
    const preview = page.locator(".map-preview");
    await expect(preview).toHaveAttribute("data-record", id);
    await preview.getByRole("button", { name: "Add to comparison" }).click();
    await expect.poll(() => camera(page)).toEqual(origin);
  }
  const tray = page.getByTestId("compare-tray");
  await expect(tray.getByRole("table")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("compare")?.split("|")).toEqual(ids);
  await tray.getByRole("button", { name: "Close compare" }).click();
  await expect(toggle).toBeVisible();
  await expect.poll(() => camera(page)).toEqual(origin);
});

test("the released My work queue opens with its real review state", async ({ page }) => {
  test.skip(!process.env.MAP_PRODUCTION_CHECK, "Runs with a signed-in account against the release.");
  const response = page.waitForResponse(r => {
    const url = new URL(r.url());
    return url.pathname === "/api/actions/comparison-decision" && url.searchParams.get("queue") === "1";
  });
  await page.goto("/?loops=work&workFilter=decisions");
  const hub = page.getByRole("region", { name: "My work" });
  await expect(hub.getByRole("button", { name: /Decisions to revisit/ })).toHaveAttribute("aria-pressed", "true");
  const read = await response;
  expect(read.status()).toBe(200);
  const { items } = await read.json();
  expect(Array.isArray(items)).toBe(true);
  const rows = hub.locator(".decision-work-row");
  await expect(rows).toHaveCount(items.length);
  if (!items.length) {
    await expect(hub.getByText("Your saved decisions are up to date.", { exact: true })).toBeVisible();
    return;
  }
  await rows.first().getByRole("link").click();
  await expect(page.locator('[data-focused-citation="true"]')).toBeFocused();
  await expect(page.getByRole("region", { name:"Comparison decision" }).getByRole("link", { name:"Back to My work" })).toBeVisible();
});

test("released Compare loads statement evidence for operating deals", async ({page}) => {
  test.skip(!process.env.MAP_PRODUCTION_CHECK,"Signed-in release check.");
  const response = await page.request.get("/api/data/deals");
  expect(response.ok()).toBe(true);
  const data = await response.json();
  type Deal = {deal_id:string;kind:string;stage_group:string;financials_open?:boolean;figures_status?:string};
  const ids = data.features.map((f:{properties:Deal})=>f.properties)
    .filter((d:Deal)=>d.kind === "pipeline" && d.stage_group !== "dropped" && d.figures_status !== "vacant" && d.financials_open !== false && !isExcludedSite(d.deal_id))
    .slice(0,2).map((d:Deal)=>d.deal_id);
  expect(ids.length).toBe(2);
  await page.goto("/?funnel=pipeline&view=list&compare="+encodeURIComponent(ids.join("|")));
  const row = page.getByTestId("compare-tray").locator('[data-compare-row="Statement revenue"]');
  await expect(row.locator("td")).toHaveCount(2);
  await expect(row).not.toContainText("Checking…");
  await expect(row.getByRole("button",{name:"Retry statement"})).toHaveCount(0);
});

test("screen property, street and grid evidence from a selected pin", async ({page}, info) => {
  test.skip(Boolean(process.env.MAP_PRODUCTION_CHECK), "Synthetic map fixtures run on pull requests.");
  await page.route("https://tiles.openfreemap.org/styles/positron", route => route.fulfill({json:{version:8,
    glyphs:"https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",sources:{},
    layers:[{id:"background",type:"background",paint:{"background-color":"#eceee6"}}]}}));
  await page.route("https://demotiles.maplibre.org/**",route=>route.fulfill({contentType:"application/x-protobuf",body:""}));
  const center = [-115.16,36.15];
  const id = "PIPE-LAS-EXAMPLE";
  await page.route("**/api/data/deals",async route=>{
    const response = await route.fetch();
    const data = await response.json();
    const template = data.features.find((f:{properties:{kind:string}})=>f.properties.kind==="pipeline");
    const features = [0,1].map(i=>({...template, geometry:{type:"Point",coordinates:[center[0]+i*.003,center[1]]},
      properties:{...template.properties,deal_id:i ? "PIPE-LAS-OTHER" : id,universe_id:"",city:"LAS",kind:"pipeline",stage_group:"desk",
        name:i ? "Example unverified site":"Example service site",address:"Example parcel",folder_url:"",cap_c_amps:null,cap_c_panels:null,
        cap_c_phase:i ? null:"3-phase",cap_c_volts:i ? null:480,cap_c_source:"Broker note",cap_c_confidence:"Claimed",cap_c_as_of:"2026-11-12",
        cap_b_horizon:"2028",cap_b_frontage:i ? null:0,cap_b_nearby:i ? null:2.2,cap_b_source:"NV Energy DRP",
        cap_b_confidence:"Estimated",cap_b_feeder:"",cap_b_as_of:"2026-10-01",cap_a_line_ft:680,cap_a_substation_mi:.32,
        cap_a_source:"OpenStreetMap",cap_a_as_of:"2026-10-01",cap_d_peak:null,cap_d_year:null}}));
    await route.fulfill({response,json:{...data,features}});
  });
  await page.route("**/api/data/grid",route=>route.fulfill({json:{type:"FeatureCollection",features:[{
    type:"Feature",properties:{kind:"substation",deal_id:id,label:"Example station · 0.32 mi"},
    geometry:{type:"Point",coordinates:[center[0]-.006,center[1]+.003]},
  }]}}));
  await page.goto("/?city=LAS&funnel=pipeline&pstage=all");
  await page.getByRole("button",{name:"Layers",exact:true}).click();
  const filters=page.getByRole("region",{name:"Power view filters"});
  await filters.getByLabel("Power view",{exact:true}).click();
  await expect(filters.getByLabel("Power view",{exact:true})).toBeChecked();
  await filters.getByLabel("Property service").selectOption("unknown");
  await filters.getByLabel("Utility coverage").selectOption("with");
  await expect(filters.getByRole("status")).toContainText("0 matching");
  await filters.getByLabel("Property service").selectOption("broker");
  await expect(filters.getByRole("status")).toContainText("1 matching");
  await page.getByRole("button",{name:"Close layers"}).click();
  const viewSwitch = page.getByRole("group",{name:"Map or list"});
  await viewSwitch.getByRole("button",{name:"List",exact:true}).click();
  const shortlist = page.getByTestId("pipeline-list");
  await expect(shortlist).toHaveAttribute("data-list-count","1");
  await expect(shortlist.locator('[data-site-row="'+id+'"]')).toContainText("Example service site");
  await viewSwitch.getByRole("button",{name:"Map",exact:true}).click();
  const nearby=page.getByRole("complementary",{name:"Nearby sites"});
  const toggle=nearby.getByRole("button",{name:/Nearby sites/});
  if(await toggle.getAttribute("aria-expanded")==="false") await toggle.click();
  await nearby.locator('[data-nearby-id="'+id+'"]').click();
  const card=page.getByRole("region",{name:"Site power"});
  await expect(card).toContainText("Broker reported");
  await expect(card).toContainText("2028 estimate");
  await expect(card).toContainText("0 MW");
  await expect(card).toContainText("2.2 MW");
  await expect(card).toContainText("680 ft away");
  await expect(card).toContainText("Mapped line unavailable");
  await expect(card).toContainText("Get a photo of the main breaker label");
  await page.waitForFunction(()=>!(window as unknown as MapWindow).__sitesMap.isMoving());
  const original=await camera(page);
  await card.getByRole("button",{name:"Show nearby grid"}).click();
  await expect.poll(()=>camera(page)).not.toEqual(original);
  // Both positions must be in the uncovered map area, including above the phone sheet.
  await expect.poll(() => page.evaluate(([lng,lat]) => {
    const map = (window as unknown as MapWindow).__sitesMap;
    const canvas = map.getCanvas().getBoundingClientRect();
    const sheet = document.querySelector(".map-preview")!.getBoundingClientRect();
    return [[lng,lat],[lng-.006,lat+.003]].map(([x,y]) => {
      const pt = map.project([x,y]);
      const left = pt.x + canvas.left, top = pt.y + canvas.top;
      const onMap = left >= canvas.left && left <= canvas.right && top >= canvas.top && top <= canvas.bottom;
      const covered = left >= sheet.left && left <= sheet.right && top >= sheet.top && top <= sheet.bottom;
      return onMap && !covered ? "visible" : `${onMap ? "under sheet" : "off map"} at ${Math.round(left)},${Math.round(top)}`;
    });
  }, center)).toEqual(["visible", "visible"]);
  await card.getByRole("button",{name:"Return to site view"}).click();
  await expect.poll(()=>camera(page)).toEqual(original);
  await page.locator(".map-preview").evaluate(el=>{el.scrollTop=0;});
  await mkdir("review-shots",{recursive:true});
  await page.locator(".map-preview").screenshot({path:"review-shots/"+info.project.name+"-map-power.png",style:"nextjs-portal { display:none !important }"});
});

test("released Power view filters open and clear on the market map", async ({page})=>{
  test.skip(!process.env.MAP_PRODUCTION_CHECK, "Read-only signed-in release check.");
  await page.goto("/?city=LAS&funnel=pipeline&pstage=all&power=1&hosting=with");
  await page.getByRole("button",{name:"Layers · Power"}).click();
  const filters=page.getByRole("region",{name:"Power view filters"});
  await expect(filters.getByLabel("Utility coverage")).toHaveValue("with");
  await filters.getByRole("button",{name:"Clear power filters"}).click();
  await expect(filters.getByLabel("Utility coverage")).toHaveValue("all");
  await page.getByRole("button",{name:"Close layers"}).click();
  const nearby=page.getByRole("complementary",{name:"Nearby sites"});
  const toggle=nearby.getByRole("button",{name:/Nearby sites/});
  if (await toggle.getAttribute("aria-expanded")==="false") await toggle.click();
  await nearby.locator("[data-nearby-id]").first().click();
  const card=page.getByRole("region",{name:"Site power"});
  for (const name of ["At the property","On the street","Nearby grid","Next check"]) {
    await expect(card.getByRole("heading",{name})).toBeVisible();
  }
  await expect(card.getByText("Checking mapped locations…")).toHaveCount(0);
  await expect(card.getByRole("button",{name:"Retry grid map"})).toHaveCount(0);
});

test("scan market readings and open the mapped wash radius", async ({page}, info) => {
  await page.goto("/?city=LAS&funnel=pipeline&pstage=all");
  await page.getByRole("button", {name:"Market context",exact:true}).click();
  const panel = page.getByRole("complementary",{name:"Market context map"});
  const list = panel.getByRole("button",{name:/Sites in view/});
  const phone = info.project.name === "mobile";
  await expect(list).toHaveAttribute("aria-expanded",phone ? "false" : "true");
  if (phone) await list.click();
  const first = panel.locator("[data-market-site]").first();
  await expect(first).toBeVisible();
  await panel.getByRole("button",{name:/Washes · 1 mi/}).click();
  await expect(panel.locator('th[aria-sort="ascending"]')).toContainText("Washes");
  await panel.getByRole("button",{name:"Trade area",exact:true}).click();
  await panel.getByRole("combobox").selectOption("income");
  await expect(panel).toContainText("median within 3 mi");
  await panel.getByRole("button",{name:"Traffic",exact:true}).click();
  await expect(panel.getByRole("button",{name:"Traffic",exact:true})).toHaveAttribute("aria-pressed","true");
  const sample = await first.evaluate(button => ({
    id: button.getAttribute("data-market-site"),
    traffic: button.closest("tr")?.querySelector("td")?.firstChild?.textContent,
  }));
  await page.waitForFunction(async ({id,traffic}) => {
    const map = (window as unknown as MapWindow).__sitesMap;
    if (!map?.getLayer("market-readings") || map.isMoving() || !map.isSourceLoaded("pins")) return false;
    const data = await map.getSource<GeoJSONSource>("pins")?.getData();
    if (data?.type !== "FeatureCollection") return false;
    const pin = data.features.find((feature: {properties: {site_id?: string} | null}) => feature.properties?.site_id === id);
    if (!pin || pin.properties?.market_label !== traffic) return false;
    const drawn = map.queryRenderedFeatures({layers:["market-readings"],filter:["==",["get","site_id"],id]});
    return drawn.every(feature => feature.properties.market_label === traffic);
  }, sample);
  if (!process.env.MAP_PRODUCTION_CHECK) {
    await mkdir("review-shots",{recursive:true});
    const name = process.env.MAP_DEPLOYED_PREVIEW ? "preview" : "local";
    await page.screenshot({path:`review-shots/${info.project.name}-${name}-market-context.png`});
  }
  await first.click();
  const preview = page.getByRole("complementary").filter({has:page.locator("#pin-preview-title")});
  const card = preview.getByRole("region",{name:"Market context"});
  await expect(card).toBeVisible();
  await card.getByRole("button",{name:"3 mi",exact:true}).click();
  await expect(card.getByRole("button",{name:"3 mi",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(card).toContainText(/\d+ mapped census location/);
  await expect(page).toHaveURL(/washRadius=3/);
  await preview.getByRole("button",{name:"Close site preview"}).click();
  await expect(panel).toBeVisible();
});
