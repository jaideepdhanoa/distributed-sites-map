import { test } from "node:test";
import assert from "node:assert/strict";
import { selectionCheck, type Inputs } from "../../lib/selection/screen";
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
