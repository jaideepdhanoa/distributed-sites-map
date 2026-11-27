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

import { listScreen, listSpace } from "../../lib/charging/listScreen";
import { defaultListAssumptions } from "../../lib/charging/preliminary";

test("list coverage counts a conditional layout, a scoped zero and an unknown separately", () => {
  const fit = listSpace(deal.chargingSpace);
  assert.equal(fit.count, 4);
  assert.match(fit.value, /4 spaces/);
  assert.match(fit.basis, /shared aisle.*0 spaces inside/);
  assert.equal(listSpace({value:"0 spaces", count:0, basis:"Parking"}).group,"zero");
  assert.equal(listSpace().group,"unmeasured");
});

test("what-if costs can be compared without creating a footprint or replacing a selected case", () => {
  const emptyFit = {...deal, chargingSpace:undefined};
  const c = {result:{siteCost:null},screen:[],screenAssumptions:assumptions,preliminary:preliminaryCost(emptyFit,assumptions)} as unknown as ChargingSummary;
  const d = {...emptyFit, charging:c};
  const screen = listScreen(d);
  assert.equal(screen.group,"scenario");
  assert.match(screen.cost.basis,/If 6 spaces fit/);
  assert.equal(screen.cost.amount,43300/6000);
  assert.equal(listScreen(d,{...defaultListAssumptions,volume:50}).cost.amount,43300/3000);
  const trial = listScreen(d,{...defaultListAssumptions,upgrade:0,attendant:0,unitBuild:0,creditCash:false});
  assert.equal(trial.cost.amount,15500/6000);
  assert.equal(listScreen({...d,charging:{...c,selected:"case:1",result:{...c.result,siteCost:8}}}).cost.amount,8);
  assert.equal(listScreen({...d,charging:{...c,stale:true}}).group,"pending");
  assert.equal(listScreen({...d,listing_removed:true}).group,"pending");
  assert.equal(listScreen({...d,asking_price:null}).cost.amount,null);
  assert.equal(listScreen({...d, charging:{...c,screenTenure:{rights:"unavailable",terms:"purchase",values:{rent:null}}}}).cost.amount,null);
  assert.equal(listSpace(d.chargingSpace).count,null);
});

import {screenLedger,scenarios} from "../../lib/charging/screenLedger";
import {saveScreen,screenHistory,screenSaveSchema} from "../../lib/charging/screenStore";
import {caseHistory,activeCases} from "../../lib/charging/store";
import {randomUUID} from "node:crypto";
import {migrate} from "../../lib/actions/migrate";
import {memorySql} from "../helpers/sql";

test("screening ledger sums to each list scenario and recalculates threshold costs",()=>{
  const estimate=preliminaryCost(deal,assumptions);
  assert.ok("layouts" in estimate);
  const l=estimate.layouts[0];
  for(const [i,scenario] of scenarios.entries()){
    const r=screenLedger(l.ledger,{},i);
    assert.equal(Object.values(r.costs).reduce((sum,n)=>sum+n,0),r.annualCost);
    assert.equal(r.sessions,l.base.sessions*scenario.volume);
    assert.equal(r.perCharge,r.annualCost/r.sessions);
  }
  assert.equal(screenLedger(l.ledger).perCharge,l.base.perCharge);
  assert.equal(screenLedger(l.ledger,{},3).perCharge,l.downside.perCharge);
  const trial=screenLedger(l.ledger,{stalls:3});
  assert.equal(trial.posts,1);assert.equal(trial.chargers,2);assert.equal(trial.sessions,3000);
  assert.equal(trial.costs.staffing,12000);
  assert.equal(screenLedger(l.ledger,{stalls:0}).perCharge,null);
  assert.equal(screenLedger(l.ledger,{volume:0}).perCharge,null);
  assert.equal(l.ledger.inputs.stalls,4);
});

test("saved screening alternative is immutable, retries safely and stays out of selected and detailed cases",async()=>{
  const sql=await memorySql();await migrate(sql);
  const estimate=preliminaryCost(deal,assumptions);
  assert.ok("layouts" in estimate);
  const basis=estimate.layouts[0].ledger,site="PIPE-PHX-9997";
  const request=screenSaveSchema.parse({kind:"screen",name:"Three stalls",id:randomUUID(),sourceRevision:"b".repeat(24),basis:JSON.parse(JSON.stringify(basis)),scenario:0,changes:{stalls:3}});
  const saved=await saveScreen(sql,site,"reviewer",request,estimate);
  assert.equal(saved.inputs.basis.inputs.stalls,4);
  assert.equal(saved.inputs.changes.stalls,3);
  assert.equal((await saveScreen(sql,site,"reviewer",request,estimate)).id,saved.id);
  assert.equal((await screenHistory(sql,site)).length,1);
  await assert.rejects(saveScreen(sql,site,"reviewer",{...request,name:"Other"},estimate),/another alternative/);
  await assert.rejects(saveScreen(sql,site,"reviewer",{...request,basis:{}},estimate),/changed/);
  assert.equal((await caseHistory(sql,site)).length,0);assert.equal((await activeCases(sql)).length,0);
  assert.equal(screenSaveSchema.safeParse({...request,changes:{perPost:0}}).success,false);
  assert.equal(screenSaveSchema.safeParse({...request,changes:{stalls:1.5}}).success,false);
});
