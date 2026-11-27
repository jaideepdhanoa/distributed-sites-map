import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("pipeline shows ranked opportunities, charging figures and a compact header", async ({page}, info) => {
  const deals = ["Example service garage", "Example express wash", "Example auto center"].map((name, i) => {
    const primary = {route:"Site lead", disposition:i === 2 ? "Watch availability" : "Shortlist", rank:i === 2 ? null : i+1,
      rationale:"An earlier listing was withdrawn.", next:"Confirm the asking price and when the buyer could take possession.",
      reviewedOn:"2026-01-01", owner:null, revisitOn:null, evidence:"https://example.org/evidence", offering:null};
    return {type:"Feature", geometry:{type:"Point",coordinates:[-112.08+i*.01,33.45]}, properties:{
      deal_id:"PIPE-PHX-90" + (10+i), kind:"pipeline", city:"PHX", name, address:"Example parcel " + (i+1),
      stage:i === 1 ? "2 Financial screen" : "1 Desk screen", stage_group:i === 1 ? "financial" : "desk",
      business_type:i === 1 ? "Car wash" : "Auto repair", score:52, service_area_class:"Inside",
      asking_price:1000000+i*200000, asking_price_display:i === 0 ? "$1,000,000" : i === 1 ? "$1,200,000" : "$1,400,000",
      opportunityReview:{name,primary,alternatives:[]}, chargingSpace: i === 2
        ? {value:"Needs measurement",basis:"Measure the inside of the service bays",count:null}
        : {value:i ? "2–4 spaces" : "4–6 spaces",basis:i ? "Vacuum row outline estimate" : "Parking outline estimate",count:i ? 2 : 4},
      charging:{name:"Illustrative case",merit:{action:"Evidence needed",next:"Measure the site.",order:5},energyScope:"included",
        result:{siteCost:i === 2 ? null : 7.25+i,missing:i === 2 ? ["Available power"] : []},screen:[],comparator:"local",selected:null,stale:false},
    }};
  });
  await page.route("**/api/data/deals",route=>route.fulfill({json:{type:"FeatureCollection",features:[...deals].reverse()}}));
  await page.route("**/api/list/layout**",route=>route.fulfill({json:{stored:false,layout:null}}));
  // Render only synthetic opportunities on both viewports.
  await page.goto("/?view=list&funnel=pipeline&city=PHX&pstage=all");
  const list=page.getByTestId("pipeline-list");
  await expect(list.getByRole("heading",{name:"Phoenix pipeline"})).toBeVisible();
  await expect(list).toContainText("Acquisition priority #1");
  const phone=info.project.name==="mobile";
  const rows=list.locator(phone ? ".list-cards > li" : "tbody tr.list-row");
  await expect(rows.first()).toContainText("Example service garage");
  await expect(rows.first()).toContainText("4–6 spaces");
  await expect(rows.first()).toContainText("$7.25");
  await expect(rows.last()).toContainText("Wait for availability");
  if (!phone) {
    const header = list.locator("thead");
    expect((await header.boundingBox())!.height).toBeLessThanOrEqual(44);
    await expect(header).not.toContainText(/Historical score|County check|Open land/);
    const button=header.getByRole("button",{name:"Column options for Charging spaces"});
    await button.focus();
    await button.press("Enter");
    await expect(page.getByRole("group",{name:"Charging spaces column"})).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(button).toBeFocused();
    await button.blur();
  }
  await mkdir("review-shots",{recursive:true});
  await page.screenshot({path:`review-shots/${info.project.name}-pipeline-overview.png`,animations:"disabled"});
  await rows.last().getByText("Example auto center",{exact:true}).click();
  const card=page.locator("aside.drawer");
  await expect(card.getByRole("heading",{name:"Wait for availability"})).toBeVisible();
  await expect(card.getByText("Deal stage",{exact:true})).toBeAttached();
  await expect(card.getByText("An earlier listing was withdrawn.")).toBeHidden();
  await expect(card.getByText("Historical score",{exact:true})).toHaveCount(0);
  if (!phone) {
    await card.getByText("Review notes and sources").click();
    await expect(card.getByText("An earlier listing was withdrawn.")).toBeVisible();
  }
});

test("filter layouts and reprice the pipeline from the list", async ({page}, info) => {
  const a = {horizon:10,demand:10,hub:1000000,capital:0,closing:.1,charging:{charges:100000,perPost:3,ports:2,
    unitBuild:10000,upgrade:20000,attendant:12000,fixed:2000,insurance:1000,perCharger:500,tax:.01}};
  const deals = ["Sample footprint trial","Sample selected case"].map((name,i) => ({
    type:"Feature",geometry:{type:"Point",coordinates:[-112+i*.01,33.45]}, properties:{
      deal_id:"PIPE-PHX-98"+(71+i), kind:"pipeline",city:"PHX",name,stage:"1 Desk screen",stage_group:"desk",
      business_type:"Auto repair",asking_price:100000, purchase:{inputs:{cash:5000,ownership:"Yes"},assumptions:a},
      chargingSpace:i ? {value:"0 spaces",count:0,basis:"Parking",layouts:[{stalls:4,condition:"Parking with shared aisle access"}]}
        : {value:"Needs measurement",count:null,basis:"Measure the bays"},
      charging:{name:"Sample case",merit:{action:"Evidence needed",order:5,next:"Measure the site."},
        result:{siteCost:i ? 8 : null,missing:[]},selected:i ? "sample:1" : null,stale:false,screen:[],energyScope:"excluded",
        preliminary:{reason:"Measure the bays"}}
    }}));
  await page.route("**/api/data/deals",route=>route.fulfill({json:{type:"FeatureCollection",features:deals}}));
  await page.route("**/api/list/layout**",route=>route.fulfill({json:{stored:false,layout:null}}));
  await page.goto("/?funnel=pipeline&view=list&city=PHX&pstage=all");
  const list=page.getByTestId("pipeline-list");
  await list.getByTestId("sort-by").selectOption("chargeCost");
  const rows=list.locator("[data-site-row]");
  await expect(rows.first()).toContainText("Sample footprint trial");
  await expect(rows.first()).toContainText("$7.22");
  await expect(rows.first()).toContainText("If 6 spaces fit");
  const phone=info.project.name==="mobile";
  if (phone) await list.getByRole("button",{name:"Figures",exact:true}).click();
  await list.getByRole("button",{name:"1 with potential spaces"}).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Up to 4 spaces");
  await list.getByRole("button",{name:"Clear charging filter"}).click();
  if (phone) await list.getByRole("button",{name:"Figures",exact:true}).click();
  await list.getByRole("button",{name:"Cost assumptions",exact:true}).click();
  const dialog=page.getByRole("dialog");
  await dialog.getByLabel("Completed charges (% of workbook)").fill("50");
  await mkdir("review-shots",{recursive:true});
  await dialog.screenshot({path:`review-shots/${info.project.name}-pipeline-assumptions.png`});
  await dialog.getByRole("button",{name:"Apply to list"}).click();
  await expect(rows.first()).toContainText("Sample selected case");
  await expect(rows.last()).toContainText("$14.43");
  await page.reload();
  await expect(rows.last()).toContainText("$14.43");
  await (phone ? rows.last().getByRole("button",{name:"View calculation"}) : rows.last().getByRole("button",{name:/\$14\.43/})).click();
  await expect(dialog).toContainText("What if this footprint fits?");

  await expect(dialog).toContainText("3,000 annual charges");
  await page.route("**/api/actions/charging?site=*",r=>r.fulfill({json:{site:deals[0].properties,history:[],source:"sample",canWrite:false}}));
  await dialog.getByRole("link",{name:"Open unit economics ledger"}).click();
  const ledger=page.getByRole("region",{name:"Preliminary site cost"});
  await expect(ledger.locator(".screen-result")).toContainText("$14.43");
  await expect(ledger).toContainText("3,000 annual charges");
  await page.getByRole("link",{name:/Back to site review/}).click();
  await list.getByRole("button",{name:"Cost assumptions · edited"}).click();
  await dialog.getByRole("button",{name:"Restore defaults"}).click();
  await expect(rows.first()).toContainText("$7.22");
  if (phone) {
    const card = rows.first(), actions = card.getByRole("button",{name:"View calculation"});
    const body = await card.locator("button.list-row").boundingBox(), action = await actions.boundingBox();
    expect(action!.y).toBeGreaterThanOrEqual(body!.y + body!.height - 1);
    expect(action!.x + action!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  await page.screenshot({path:`review-shots/${info.project.name}-pipeline-charging.png`,animations:"disabled"});
});
