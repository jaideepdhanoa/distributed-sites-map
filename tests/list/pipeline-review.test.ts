import assert from "node:assert/strict";
import test from "node:test";
import { PIPELINE_COLUMNS, defaultColumnIds } from "../../lib/keyNumbers";
import { allowedIds, sanitizeLayout } from "../../lib/listLayout";
import { pipelineCost } from "../../lib/charging/pipelineCost";
import { pipelineFit } from "../../lib/spaces/pipelineFit";
import type { ChargingSummary } from "../../lib/charging/summary";
import type { MapSpaceSite } from "../../lib/spaces/mapCatalog";
import type { Assessment } from "../../lib/spaces/options";

test("old column layouts acquire the decision columns once and retain the remaining customisation", () => {
  const ids = PIPELINE_COLUMNS.map(c => c.id);
  const old = { order:["site","score","stage","openLand","county","asking"], widths:{asking:400}, pinned:["site"], filters:{score:"7",asking:"test"} };
  const layout = sanitizeLayout(old, ids);
  assert.deepEqual(layout.order.slice(0,4), ["site","priority","spaces","chargeCost"]);
  assert.equal(layout.widths.asking,400);
  assert.deepEqual(layout.filters,{asking:"test"});
  assert.deepEqual(layout.sort,{id:"chargeCost",desc:false});
  for (const id of ["county","score","openLand"]) assert.ok(layout.hidden.includes(id));
  assert.deepEqual(sanitizeLayout(layout,ids),layout);
  assert.deepEqual(defaultColumnIds().slice(0,4), ["site","priority","spaces","chargeCost"]);
  assert.ok(!allowedIds(ids,false).some(id=>["priority","spaces","chargeCost"].includes(id)));
});

test("space estimates compare alternative layouts and retain the measurement basis", () => {
  const zone = { kind:"parking", label:"Example parking", points:[[0,0],[50,0],[50,50],[0,50]] };
  const site = {frame:{width:600,height:500,metersPerPixel:.24},zones:[zone]} as MapSpaceSite;
  const fit = pipelineFit(site,undefined,true,12);
  assert.ok(fit.count != null && fit.count > 0);
  assert.match(fit.basis,/Parking outline estimate/);
  assert.deepEqual(pipelineFit({...site,zones:[...site.zones,...site.zones]},undefined,true,12),fit);
  assert.equal(pipelineFit(site,undefined,false,12).count,null);
  assert.equal(pipelineFit({...site,zones:site.zones.map(z=>({...z,kind:"bay"}))},undefined,true,12).count,null);
  assert.equal(pipelineFit(undefined,undefined,true,0).count,null);
  assert.equal(pipelineFit(undefined,{recorded:0,baseline:"recorded"} as Assessment,true,0).count,0);
});

test("site costs keep zero, missing figures, hypothetical network cases and stale selections distinct", () => {
  const c = {result:{siteCost:0,missing:[]},energyScope:"excluded",screen:[]} as unknown as ChargingSummary;
  assert.equal(pipelineCost(c).value,"$0.00");
  assert.match(pipelineCost(c).basis,/excludes electricity/);
  assert.equal(pipelineCost({...c,stale:true}).amount,null);
  const incomplete = {...c,result:{...c.result,siteCost:null,missing:["Available power"]}};
  assert.match(pipelineCost(incomplete).basis,/Available power/);
  const example = pipelineCost({...incomplete,screenDepot:10,screen:[{stalls:4,base:.1,downside:0}]});
  assert.equal(example.amount,null);
  assert.match(example.basis,/Network example: \$9.00\/charge at 4 assumed spaces/);
});

test("a conditional one-to-three-stall layout is counted below the four-stall screening threshold", () => {
  const site = {frame:{width:100,height:100,metersPerPixel:.3048},
    zones:[{kind:"parking",label:"Example strip",points:[[0,0],[29,0],[29,20],[0,20]]}]} as MapSpaceSite;
  const fit = pipelineFit(site,undefined,true,null);
  assert.equal(fit.count,0);
  assert.deepEqual(fit.layouts,[{stalls:3,condition:"Parking with shared aisle access"}]);
  assert.match(fit.basis,/up to 3 with a shared aisle/);
});
