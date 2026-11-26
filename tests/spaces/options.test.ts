import assert from "node:assert/strict";
import test from "node:test";
import { conversionReturn, firstOption, fitRange, optionZones, outlineDimensions, recordedFit, threshold, usableOutline, type Assessment, type Zone } from "@/lib/spaces/options";
import { readReview, reviewBody } from "@/lib/spaces/optionReview";
import { assessmentSchema } from "@/lib/spaces/assessmentLoad";
const yard: Zone = { kind: "parking", label: "East row", points: [[10,10],[60,10],[60,50],[10,50]] };
const row: Assessment = { status: "reviewed", summary: "A working yard borders the shop.", zones: [yard,{...yard,kind:"bay",label:"Service bay"}], recorded:0, baseline:"recorded", segment:"",cohort:"active",revision:"abcdef012345" };
test("competing options retain their own footprint and preserve a zero or missing evidence", () => {
  assert.equal(firstOption(row),"outdoor");
  assert.deepEqual(optionZones(row,"retain"),[]);
  assert.equal(optionZones(row,"bays").length,1);
  assert.deepEqual(optionZones({...row,status:"hold"},"outdoor"),[]);
  assert.match(recordedFit(row),/^0 stalls/);
  assert.match(recordedFit({...row,recorded:null}),/No recorded/);
  assert.match(recordedFit({...row,baseline:"conflict"}),/conflicts/);
});
test("model fit and operating impact separately, including the four-stall crossing", () => {
  assert.deepEqual(fitRange(40,44,5,"stalls_90"),[0,4]);
  assert.match(threshold(0,4),/depends/);
  assert.equal(fitRange(40,44,45,"stalls_90"),null);
  assert.equal(conversionReturn(100,NaN,0,0),null);
  assert.deepEqual(conversionReturn(100000,70000,20000,10000),{net:40000,years:2.5});
  assert.equal(conversionReturn(20,10,10,0)?.years,null);
  assert.equal(outlineDimensions({...yard,kind:"bay"},[-110,34,-109.999,33.999]),null);
  assert.equal(outlineDimensions(yard,undefined),null);
  assert.ok(outlineDimensions(yard,[-110,34,-109.999,33.999]));
});
test("team corrections stay bound to their source and reject crossed or empty geometry", () => {
  const review = {disposition:"Keep for diligence" as const,option:"outdoor" as const,area:yard.label,revision:row.revision,frame:"abcdef0123456789",points:yard.points,reason:"Confirm easement.",assumptions:"Three evening hours"};
  assert.deepEqual(readReview({deleted:false,parentId:null,body:reviewBody(review)}),review);
  assert.equal(usableOutline([[0,0],[0,10],[10,0],[10,10]]),false);
  assert.equal(usableOutline([[1,1],[1,1],[2,2]]),false);
  assert.equal(usableOutline(yard.points),true);
  assert.equal(assessmentSchema.safeParse({...row,image:{src:"https://example.org",id:"0000000000000000",width:100,height:100,source:"Map",date:""}}).success,false);
});
