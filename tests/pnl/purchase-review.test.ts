import assert from "node:assert/strict";
import test from "node:test";
import type { DealProps } from "../../lib/types";
import {
  financialEvidence, originalScenario, purchaseCase, purchaseCheck, purchaseRows, preferredScenario,
  readScenario, scenarioAnchor, scenarioFigure,
} from "../../lib/purchaseReview";

import { example } from "../fixtures/purchase-review";
const site = { kind:"pipeline", deal_id:"PIPE-PHX-9999", purchase:example, asking_price:800000 } as DealProps;
test("use the recast by default and preserve the original workbook output",()=>{
  assert.equal(preferredScenario(site).basis,"normalized");
  const base=purchaseCase(example,originalScenario);
  assert.equal(base.cash,65000);
  assert.equal(base.ceiling,772727);
  const recast=purchaseCase(example,{...originalScenario,basis:"normalized"});
  assert.equal(recast.cash,45000);
  assert.equal(recast.gap,-43000);
  assert.ok(Math.abs(recast.cashPrice!-45000/.11)<.01);
  assert.ok(Math.abs(recast.ceiling!-65000/.11)<.01);
  assert.equal(purchaseCheck(site),"Reconcile earnings basis");
});
test("keep losses, confirmed zeros, and missing inputs distinguishable",()=>{
  const missing={...example,inputs:{...example.inputs,cash:null,ceiling:null,ebitda:null,normalized:null,revenue:null}};
  assert.equal(purchaseCase(missing,originalScenario).cash,null);
  assert.equal(purchaseRows({...site,purchase:missing})[1].value,"—");
  const loss=purchaseCase({...example,inputs:{...example.inputs,normalized:0}}, {...originalScenario,basis:"normalized"});
  assert.equal(loss.cash,-35000);
  assert.equal(loss.cashPrice,0);
  assert.equal(loss.ceiling,0);
  const closed=purchaseCase({...example,inputs:{...example.inputs,open:"No",cash:0}},{...originalScenario,lostCash:100});
  assert.equal(closed.cash,0);
});
test("apply recurring displacement, incremental upgrade and one-time interruption separately",()=>{
  const scenario={basis:"normalized" as const,layout:"abcdef123456.0",lostCash:5000,upgrade:20000,downtime:3};
  const result=purchaseCase(example,scenario);
  assert.equal(result.cash,40000);
  assert.equal(result.extraAnnual,2000);
  assert.equal(result.gap,-50000);
  assert.equal(result.firstYear,30000);
  assert.ok(Math.abs(result.ceiling!-58000/.11)<.01);
  assert.deepEqual(readScenario(scenarioAnchor(scenario)),scenario);
  assert.equal(readScenario("v1|workbook|0|0|13|"),null);
  assert.equal(readScenario("v1|workbook|0|-30|0|"),null);
  assert.ok(scenarioFigure(site,scenario)?.basis.includes("Excess parking"));
  assert.equal(scenarioFigure({...site,purchase:{...example,layout:undefined}},scenario),null);
});
test("document received, statements, unavailability and withheld are different states",()=>{
  assert.equal(financialEvidence({...site,purchase:undefined,statementCoverage:"unavailable"}),"Statement lookup unavailable");
  assert.equal(financialEvidence({...site,purchase:undefined,statementCoverage:"empty",package_status:"Received"}),"Package on file");
  assert.equal(financialEvidence({...site,statementCoverage:"present"}),"P&L captured");
  assert.equal(financialEvidence({...site,figures_status:"withheld"}),"Withheld");
  assert.equal(financialEvidence({...site,kind:"land"}),"Not applicable");
});

test("a saved purchase case resolves against current records and flags a changed footprint", async () => {
  const { decisionCatalog } = await import("../../lib/actions/decisionCatalog");
  const { evidenceChanged } = await import("../../lib/comparisonDecision");
  const scenario = { ...originalScenario, basis: "normalized" as const, layout: "abcdef123456.0", upgrade: 1000 };
  const citation = {
    targetId: site.deal_id, targetKind: "deal" as const, measure: "purchase_case" as const,
    ...scenarioFigure(site, scenario)!,
  };
  const current = decisionCatalog([], [site]).figure(citation);
  assert.ok(current && !evidenceChanged(citation,current));
  const revised = {...site, purchase:{...example, layout:{revision:"999999999999", zones:["Excess parking"]}}};
  const changed = decisionCatalog([], [revised]).figure(citation);
  assert.ok(changed && evidenceChanged(citation,changed));
  assert.equal(changed.value,"—");
});
