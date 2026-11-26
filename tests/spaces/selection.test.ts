import { test } from "node:test";
import assert from "node:assert/strict";
import { investmentScreen, selectionCheck, type Inputs } from "../../lib/selection/screen";
const row: Inputs = {stage:"Desk",segment:"Repair",land:false,unavailable:false,control:false,section:"",screen:0,recorded:0};

test("selection review retains zero-stall conversion and fourth-stall checks", () => {
  assert.equal(selectionCheck("PHX",row,"Test a conversion",false)[0],"Test conversion");
  assert.equal(selectionCheck("LAS",row,"Test the fourth stall",false)[0],"Measure fourth stall");
  assert.equal(selectionCheck("MIA",undefined,"No assessed layout",false)[0],"Complete first screen");
});
test("selection prioritizes mandate, sale rights and a separate fleet-service path", () => {
  assert.equal(selectionCheck("SNA",row,"Test a conversion",false)[0],"Outside mandate");
  assert.equal(selectionCheck("PHX",{...row,land:true},"Test a conversion",false)[0],"Land paused");
  assert.equal(selectionCheck("MIA",row,"Test a conversion",true)[0],"Check disposition");
  assert.equal(selectionCheck("MIA",{...row,segment:"Quick lube",control:true},"Test a conversion",false)[0],"Resolve site rights");
  assert.equal(selectionCheck("MIA",{...row,segment:"Quick lube"},"Revisit site evidence",false)[0],"Screen fleet service");
});

test("investment screen respects role, zero, missing inputs and the current depot parity hurdle", () => {
  assert.equal(investmentScreen({...row,hurdle:0.3},true),"Workbook reaches depot parity · verify inputs");
  assert.equal(investmentScreen({...row,hurdle:0.35,screen:0.35},true),"Workbook reaches depot parity · verify inputs");
  assert.equal(investmentScreen({...row,hurdle:0.3,screen:null},true),"Investment case unverified");
  assert.equal(investmentScreen({...row,hurdle:0.3},false),"Investment case unverified");
});

test("pin, record and comparison share the assessed layout, condition and recorded blocker", async () => {
  const {screenSummary} = await import("../../lib/selection/screen");
  const {screeningEvidence,previewFitFigure} = await import("../../lib/screeningEvidence");
  const {dealRows} = await import("../../lib/comparison");
  const option={fit:"Outdoor conversion · up to four if aisle access is confirmed",focus:"Test a conversion" as const};
  const gate=screenSummary("PHX",undefined,option,{stage_blocker:"Confirm exclusive access"});
  const deal={deal_id:"example",kind:"pipeline",stage_group:"desk",bays_that_fit:4,screening:gate} as import("../../lib/types").DealProps;
  const brief=screeningEvidence({deal,signedIn:true});
  assert.equal(brief.review,gate.instruction);
  assert.equal(previewFitFigure(brief.figures)?.value,option.fit);
  assert.equal(dealRows(deal,[],true).find(r=>r.label==="Next check")?.value,gate.instruction);
  const projected=screenSummary("PHX",undefined,option,{});
  assert.equal(projected.priority,"Test conversion");
  const updated={...deal,screening:projected,stage_blocker:"Review the financial statement."};
  assert.equal(screeningEvidence({deal:updated,signedIn:true}).evidence?.kind,"financials");
  assert.equal(dealRows(updated,[],true).find(r=>r.label==="Next check")?.value,updated.stage_blocker);
});
