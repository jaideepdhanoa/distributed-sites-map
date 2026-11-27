import assert from "node:assert/strict";
import test from "node:test";
import type { DealProps } from "../../lib/types";
import type { PurchaseAssumptions } from "../../lib/purchaseReview";
import { preliminaryCost } from "../../lib/charging/preliminary";
import { costRange, pipelineCost } from "../../lib/charging/pipelineCost";
import { initialCase } from "../../lib/charging/model";
import type { ChargingSummary } from "../../lib/charging/summary";

const assumptions = {horizon:10, demand:10, capital:0, closing:0.1,
  charging:{charges:100000, perPost:3, ports:2, unitBuild:10000, upgrade:20000,
    attendant:12000, fixed:2000, insurance:1000, perCharger:500, tax:0.01}} as PurchaseAssumptions;
const deal = {kind:"pipeline", asking_price:100000, purchase:{inputs:{cash:5000,ownership:"Yes"}},
  chargingSpace:{count:0, value:"0 spaces", layouts:[{stalls:4,condition:"Parking with shared aisle access"}]}} as DealProps;

test("site range reconciles separate site costs and scaled completed charges", () => {
  const estimate = preliminaryCost(deal, assumptions);
  assert.ok("layouts" in estimate);
  const [layout] = estimate.layouts;
  assert.equal(estimate.space,"0 spaces");
  assert.match(layout.condition,/shared aisle/);
  assert.deepEqual(layout.base,{sessions:4000,upgrade:20000,annualCost:40600,perCharge:10.15});
  assert.deepEqual(layout.downside,{sessions:3000,upgrade:30000,annualCost:41700,perCharge:13.9});
  const summary = {result:{siteCost:null},screen:[],preliminary:estimate} as unknown as ChargingSummary;
  assert.equal(pipelineCost(summary).value,costRange(layout));
  assert.equal(pipelineCost({...summary,stale:true}).amount,null);
  assert.equal(pipelineCost({...summary,result:{...summary.result,siteCost:4},selected:"selected"}).amount,4);
});

test("a missing measurement, stale offer, or incomplete assumption cannot generate a price", () => {
  const blocked=(d:DealProps, a=assumptions)=>assert.ok("reason" in preliminaryCost(d,a));
  blocked({...deal,chargingSpace:{count:0,value:"0 spaces",basis:"Pad alone"}});
  blocked({...deal,chargingSpace:undefined});
  blocked({...deal,listing_removed:true});
  blocked({...deal,asking_price:null});
  blocked({...deal,selectionResearch:{basis:"Public quote; scope restricted or unresolved",quote:100000} as DealProps["selectionResearch"]});
  blocked(deal,{...assumptions,charging:{...assumptions.charging,charges:null}});
});

test("limited rights and lease terms do not inherit a purchase price or the seller's income", () => {
  const selected=initialCase(deal);
  selected.terms="lease"; selected.values.rent=800;
  assert.ok("reason" in preliminaryCost(deal,assumptions,selected));
  selected.rights="controlled";
  const estimate=preliminaryCost(deal,assumptions,selected);
  assert.ok("layouts" in estimate);
  assert.equal(estimate.cash,0);
  assert.equal(estimate.price,800);
  assert.equal(estimate.layouts[0].base.annualCost,44200);
});

test("a parcel row includes documented conversion cost and income displacement once",()=>{
  const row={stalls:4,condition:"North parking",parcel:true,conversionCost:10000,lostAnnualCash:1000};
  const priced=preliminaryCost({...deal,chargingSpace:{count:4,value:"4 spaces",basis:"Conditional",layouts:[row]}},assumptions);
  assert.ok("layouts" in priced);
  const prior=preliminaryCost({...deal,chargingSpace:{count:4,value:"4 spaces",basis:"Conditional",layouts:[{...row,conversionCost:0,lostAnnualCash:0}]}},assumptions);
  assert.ok("layouts" in prior);
  assert.equal(priced.layouts[0].build-prior.layouts[0].build,10000);
  assert.equal(priced.layouts[0].base.annualCost-prior.layouts[0].base.annualCost,2100);
});
