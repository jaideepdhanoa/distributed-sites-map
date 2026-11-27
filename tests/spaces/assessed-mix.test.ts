import test from "node:test";
import assert from "node:assert/strict";
import { assessedCases,areaCounts } from "../../lib/spaces/assessedMix";
import { sketchCase } from "../../lib/spaces/parcelLayout";
import { pipelineFit } from "../../lib/spaces/pipelineFit";
import type { Zone,Assessment } from "../../lib/spaces/options";
import type { MapSpaceSite } from "../../lib/spaces/mapCatalog";

const frame={width:200,height:200,metersPerPixel:.3048};
const reviewed={status:"reviewed"} as Assessment;
const rect=(label:string,kind:Zone["kind"],x:number,y:number,w:number,h:number):Zone=>
  ({label,kind,points:[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]});
const zones=[rect("West","parking",5,20,22,22),rect("East","parking",35,20,22,22),rect("Shop","bay",65,40,22,12)];
test("opens the combined parking layout and offers a separately drawn refit",()=>{
  const all=assessedCases(zones,frame,reviewed);
  assert.deepEqual(areaCounts(all[0].rows),[{area:"West",stalls:4},{area:"East",stalls:4}]);
  const conversion=all.find(p=>p.name.includes("bay conversion"))!;
  assert.equal(sketchCase(conversion,zones,frame)?.stalls.length,12);
  assert.equal(sketchCase({...conversion,rows:conversion.rows.filter(r=>r.area!=="East")},zones,frame)?.stalls.length,8);
  const fit=pipelineFit({frame,zones} as MapSpaceSite,reviewed,true,null);
  assert.equal(fit.count,8);
  assert.equal(fit.layouts?.find(l=>l.operatingConversion)?.stalls,12);
  assert.deepEqual(assessedCases(zones,frame,reviewed),all);
});
test("shared geometry, protected aisles, source holds and missing scale constrain the system",()=>{
  const overlapping=[zones[0],{...zones[0],label:"Alternate use"}];
  assert.equal(sketchCase(assessedCases(overlapping,frame,reviewed)[0],overlapping,frame)?.stalls.length,4);
  assert.equal(assessedCases([{...zones[0],fitHold:"footprint"}],frame,reviewed).length,0);
  assert.equal(assessedCases(zones,{width:200,height:200},reviewed).length,0);
  assert.equal(assessedCases(zones,frame,{...reviewed,status:"hold"}).length,0);
  const surrounded=[zones[2],rect("Protected drive","clear",55,25,42,45)];
  assert.equal(assessedCases(surrounded,frame,reviewed).length,0);
});
test("retains a filed lower count without adding alternative uses of the same court",()=>{
  const rows=[{area:"West",edge:0,angle:90 as const,count:2},{area:"East",edge:0,angle:90 as const,count:2}];
  const parcelCases=[{name:"Lower",condition:"Retain customer spaces",rows},{name:"Higher",condition:"Release both rows",rows:rows.map(r=>({...r,count:4})),conversionCost:125}];
  const all=assessedCases(zones,frame,{...reviewed,parcelCases});
  assert.equal(all[0].conversionCost,125);
  assert.equal(sketchCase(all[0],zones,frame)?.stalls.length,8);
  assert.equal(all.at(-2)?.name,"Lower");
  for(const c of all) assert.equal(sketchCase(c,zones,frame)?.stalls.length,c.rows.reduce((n,r)=>n+r.count,0));
});

test("physical fit survives unconfirmed rights while the drawn shared lane must fit",()=>{
  const band=rect("Parking","parking",20,30,20,10);
  const aisle=[[19,17],[43,17],[43,30],[19,30]] as Zone["points"];
  const pending={...band,driveAisle:aisle,useRight:{status:"unconfirmed" as const,detail:"Confirm parking allocation."}};
  const fit=(zones:Zone[])=>pipelineFit({frame,zones} as MapSpaceSite,reviewed,true,null);
  assert.equal(fit([pending]).count,4);
  assert.deepEqual(fit([pending]).layouts?.[0].rights,{documented:0,pending:4,checks:["Confirm parking allocation."]});
  const documented={...pending,useRight:{status:"documented" as const,detail:"Signed parking and access exhibit."}};
  assert.equal(fit([documented]).layouts?.[0].rights?.documented,4);
  const narrow={...pending,driveAisle:rect("Lane","clear",20,22,22,8).points};
  assert.equal(assessedCases([narrow],frame,reviewed).length,0);
});
