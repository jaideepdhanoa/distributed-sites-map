import assert from "node:assert/strict";
import test from "node:test";
import { bestRow, rotateOutline, sketchCase, sketchRow, type ParcelCase } from "../../lib/spaces/parcelLayout";
import type { Zone } from "../../lib/spaces/options";

const frame={width:100,height:100,metersPerPixel:0.3048};
const lot:Zone={kind:"parking",label:"North",points:[[2,2],[74,2],[74,47],[2,47]]};
const proposal: ParcelCase={name:"North row",condition:"Confirm access",rows:[{area:"North",edge:0,angle:90,count:8}]};
test("eight perpendicular spaces and their aisle fit a rotated row",()=>{
  const actual=sketchCase(proposal,[lot],frame);
  assert.equal(actual?.stalls.length,8);
  assert.equal(actual?.aisles.length,1);
  const rotated=rotateOutline([[15,21],[87,21],[87,66],[15,66]],20,frame);
  assert.ok(rotated);
  assert.equal(sketchCase(proposal,[{...lot,points:rotated}],frame)?.stalls.length,8);
});
test("a protected island inside an aisle invalidates the combined case",()=>{
  const clear:Zone={kind:"clear",label:"Equipment",points:[[35,26],[39,26],[39,30],[35,30]]};
  assert.equal(sketchCase(proposal,[lot,clear],frame),null);
  assert.equal(sketchCase({...proposal,rows:[...proposal.rows,...proposal.rows]},[lot],frame),null);
  const irregular:Zone={...lot,points:[[2,2],[74,2],[74,47],[39,47],[39,26],[35,26],[35,47],[2,47]]};
  assert.ok(sketchRow(irregular,frame,0,90,8,[])!.stalls.length < 8);
});
test("angled stalls use one-way depth and geometry stays inside the footprint",()=>{
  const shallow:Zone={...lot,points:[[2,2],[90,2],[90,38],[2,38]]};
  assert.equal(sketchRow(shallow,frame,0,90,8,[])?.stalls.length,0);
  assert.ok(sketchRow(shallow,frame,0,45,8,[])!.stalls.length>0);
  assert.equal(bestRow(shallow,frame,[])?.angle,45);
  assert.equal(sketchCase(proposal,[{...lot,fitHold:"aisle"}],frame),null);
  assert.equal(sketchCase(proposal,[lot],undefined),null);
});

test("a trial on another edge does not displace an assessed adjacent-aisle option",async()=>{
  const {pipelineFit}=await import("../../lib/spaces/pipelineFit");
  const pad: Zone={kind:"pad",label:"Pad",points:[[0,0],[48,0],[48,30],[0,30]]};
  const site={zones:[pad],frame} as import("../../lib/spaces/mapCatalog").MapSpaceSite;
  const assessment={inventory:{parking:"Reviewed",ground:"Reviewed",operations:"Verify the shared drive",bays:"Check clearance"}} as import("../../lib/spaces/options").Assessment;
  const result=pipelineFit(site,assessment,true,0);
  assert.match(result.layouts!.at(-1)!.condition,/shared aisle/);
  assert.equal(result.layouts!.at(-1)!.stalls,5);
});

test("a traced development area supports a conditional case after its footprint hold clears", () => {
  const ground: Zone = { ...lot, kind: "ground" };
  assert.equal(sketchCase(proposal, [ground], frame)?.stalls.length, 8);
  assert.equal(sketchCase(proposal, [{ ...ground, fitHold: "footprint" }], frame), null);
});
