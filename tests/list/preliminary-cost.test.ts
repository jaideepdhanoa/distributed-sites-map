import assert from "node:assert/strict";
import test from "node:test";
import type { DealProps } from "../../lib/types";
import type { PurchaseAssumptions } from "../../lib/purchaseReview";
import { preliminaryCost } from "../../lib/charging/preliminary";
import { costRange, displayedDepot, displayedFit, pipelineCost } from "../../lib/charging/pipelineCost";
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
  assert.deepEqual(layout.downside,{sessions:4000,upgrade:30000,annualCost:41700,perCharge:10.425});
  const summary = {result:{siteCost:null},screen:[],preliminary:estimate} as unknown as ChargingSummary;
  assert.equal(pipelineCost(summary).value,costRange(layout));
  const staleSaved={...summary,selected:"saved:1",stale:true,result:{...summary.result,siteCost:4}};
  assert.equal(pipelineCost(staleSaved).amount,layout.base.perCharge);
  assert.match(pipelineCost(staleSaved).basis,/selected case needs recalculation/);
  assert.equal(listScreen({...deal,charging:staleSaved}).cost.value,costRange(layout));
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
  assert.equal(listScreen(d).group,"pending");
  const screen = listScreen(d,{...defaultListAssumptions,assumeFit:true});
  assert.equal(screen.group,"scenario");
  assert.match(screen.cost.basis,/If 6 spaces fit/);
  assert.equal(screen.cost.amount,43300/6000);
  assert.equal(listScreen(d,{...defaultListAssumptions,assumeFit:true,volume:50}).cost.amount,43300/6000);
  const trial = listScreen(d,{...defaultListAssumptions,assumeFit:true,upgrade:0,attendant:0,unitBuild:0,creditCash:false});
  assert.equal(trial.cost.amount,15500/6000);
  assert.equal(listScreen({...d,charging:{...c,selected:"case:1",result:{...c.result,siteCost:8}}}).cost.amount,8);
  assert.equal(listScreen({...d,charging:{...c,stale:true}}).group,"pending");
  assert.equal(listScreen({...d,listing_removed:true}).group,"pending");
  assert.equal(listScreen({...d,asking_price:null}).cost.amount,null);
  assert.equal(listScreen({...d, charging:{...c,screenTenure:{rights:"unavailable",terms:"purchase",values:{rent:null}}}}).cost.amount,null);
  assert.equal(listSpace(d.chargingSpace).count,null);
});

import {screenLedger,savedChanges} from "../../lib/charging/screenLedger";
import {saveScreen,screenHistory,screenSaveSchema} from "../../lib/charging/screenStore";
import {caseHistory,activeCases} from "../../lib/charging/store";
import {randomUUID} from "node:crypto";
import {migrate} from "../../lib/actions/migrate";
import {memorySql} from "../helpers/sql";

test("screening ledger sums to each list scenario and recalculates threshold costs",()=>{
  const estimate=preliminaryCost(deal,assumptions);
  assert.ok("layouts" in estimate);
  const l=estimate.layouts[0];
  for(const upgrade of [0,20000,30000]){
    const r=screenLedger(l.ledger,{upgrade});
    assert.equal(Object.values(r.costs).reduce((sum,n)=>sum+n,0),r.annualCost);
    assert.equal(r.sessions,l.base.sessions);
    assert.equal(r.perCharge,r.annualCost/r.sessions);
  }
  assert.equal(screenLedger(l.ledger).perCharge,l.base.perCharge);
  assert.equal(screenLedger(l.ledger,{upgrade:30000}).perCharge,l.downside.perCharge);
  const archived=savedChanges({id:"archive",author:"Reviewer",at:"2025-01-01",name:"Historic",inputs:{basis:l.ledger,changes:{},scenario:3}});
  assert.equal(screenLedger(l.ledger,archived).perCharge,13.9);
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
  await assert.rejects(saveScreen(sql,site,"reviewer",{...request,changes:{volume:75}},estimate),/shared across/);
  assert.equal((await caseHistory(sql,site)).length,0);assert.equal((await activeCases(sql)).length,0);
  assert.equal(screenSaveSchema.safeParse({...request,changes:{perPost:0}}).success,false);
  assert.equal(screenSaveSchema.safeParse({...request,changes:{stalls:1.5}}).success,false);
});

test("a layout's conversion and displaced income reconcile when business credit is removed",()=>{
  for(const lostAnnualCash of [1000,8000]){
    const layout={stalls:4,condition:"Parking",parcel:true,conversionCost:10000,lostAnnualCash};
    const site={...deal,chargingSpace:{count:4,value:"4 spaces",basis:"Conditional",layouts:[layout]}};
    const result=preliminaryCost(site,assumptions,undefined,{hypothetical:false,assumptions:{...defaultListAssumptions,creditCash:false}});
    assert.ok("layouts" in result);
    const row=result.layouts[0];
    assert.equal(row.layoutCash,Math.min(0,5000-lostAnnualCash));
    const calc=screenLedger(row.ledger);
    assert.equal(calc.costs.conversion,1000);
    assert.equal(calc.costs.displaced+calc.costs.cash,Math.max(0,lostAnnualCash-5000));
    assert.equal(calc.annualCost,row.base.annualCost);
    assert.equal(row.base.annualCost,40600+5000+1100+Math.max(0,lostAnnualCash-5000));
  }
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

test("combined cases retain equal utilization and remove unverified income from a conversion",()=>{
  const layouts=[{stalls:8,condition:"Parking",system:true,parcel:true},
    {stalls:12,condition:"Parking and bay refit",system:true,parcel:true,operatingConversion:true}];
  const fit={value:"8 spaces",count:8,basis:"System estimate",layouts};
  const estimate=preliminaryCost({...deal,chargingSpace:fit},assumptions);
  assert.ok("layouts" in estimate);
  const [parking,conversion]=estimate.layouts;
  assert.equal(conversion.base.sessions,parking.base.sessions*1.5);
  assert.equal(conversion.ledger.inputs.cash,0);
  assert.equal(parking.ledger.inputs.cash,5000);
  assert.equal(conversion.ledger.withheldOperatingCash,5000);
  assert.equal(screenLedger(conversion.ledger,{displaced:1250}).costs.cash,-5000);
  assert.equal(screenLedger(conversion.ledger,{displaced:1250,cash:0}).costs.cash,0);
  assert.equal(screenLedger(conversion.ledger,{displaced:1250}).annualCost,conversion.base.annualCost-3750);
  assert.equal(conversion.ledger.inputs.price,parking.ledger.inputs.price);
  assert.equal(conversion.ledger.conversionRecorded,false);
  const reduced=screenLedger(conversion.ledger,{stalls:4});
  assert.ok(reduced.perCharge!=null && costRange(conversion,4).startsWith("$"+reduced.perCharge.toFixed(2)));
  assert.equal(costRange(parking,parking.stalls),costRange(parking));
});

test("the site editor and list follow current assessed geometry and preserve a measured zero",()=>{
  for(const count of [null,0,7]){
    const physical={count,value:String(count),basis:"Current drawing"};
    assert.equal(initialCase({...deal,bays_that_fit:18,chargingSpace:physical}).values.stalls,count);
  }
});

test("filing an acquisition as investigated or shortlisted preserves its pricing evidence",()=>{
  const current={...deal,chargingSpace:{count:5,value:"5 spaces",basis:"Drawn",
    layouts:[{stalls:5,condition:"Parking",parcel:true,system:false}]}};
  const cases=[{stalls:5,price:current.asking_price,cash:1000,base:1}];
  const run=(disposition:string)=>preliminaryCost({...current,opportunityReview:{
    primary:{disposition,route:"Operating acquisition"},coverage:{cases}}} as typeof deal,assumptions);
  assert.deepEqual(run("Investigate"),run("Shortlist"));
  const result=run("Investigate");
  assert.ok("layouts" in result);
  assert.match(result.priceBasis,/Filed/);
});

test("uncombining uses the exact remaining geometry and requires allocation of bundled works",async()=>{
  const {remainingBasis}=await import("../../lib/charging/screenLedger");
  const result=preliminaryCost(deal,assumptions);
  assert.ok("layouts" in result);
  const seed=result.layouts[0].ledger;
  const original={...seed,inputs:{...seed.inputs,stalls:6,conversion:10000,cash:0},withheldOperatingCash:2000,
    parts:[{area:"Parking",stalls:4},{area:"Bay",stalls:2}],areaKinds:{Parking:"parking",Bay:"bay"},componentIds:{Parking:"row1",Bay:"row2"}};
  const parking=remainingBasis(original,["Bay"],[]);
  assert.equal(parking.inputs.cash,2000);
  assert.equal(parking.inputs.conversion,0);
  assert.equal(parking.inputs.stalls,4);
  const bays=remainingBasis(original,["Parking"],[]);
  assert.equal(screenLedger(bays).perCharge,null);
  assert.ok(screenLedger(bays,{conversion:1000}).perCharge!=null);
  assert.equal(remainingBasis(original,["Bay"],[parking]),parking);
});

test("a selected local case and a priced system layout each retain their own comparator and stall count",()=>{
  const preliminary=preliminaryCost(deal,{...assumptions,hub:2000000});
  assert.ok("layouts" in preliminary);
  const c={result:{siteCost:null,depot:7},preliminary,comparator:"local",selected:"case:1",selectedStalls:9,name:"Local case"} as unknown as ChargingSummary;
  assert.deepEqual(displayedDepot(c),{amount:20,label:"Workbook depot proxy"});
  const selected={...c,result:{...c.result,siteCost:6}};
  assert.deepEqual(displayedDepot(selected),{amount:7,label:"Local depot"});
  assert.equal(displayedFit(deal.chargingSpace,selected)?.count,9);
});

test("identified opportunities automatically price conflicting inputs and preserve the physical count",()=>{
  const site={...deal,stage:"Desk screen",chargingSpace:{count:null,value:"Needs measurement",basis:"Aisle unresolved"},
    asking_price:140000,selectionResearch:{quote:110000,scope:"Property",basis:"Public whole-property ask"},
    opportunityReview:{primary:{disposition:"Investigate",route:"Property only",next:"Check the aisle"},coverage:{countyStatus:"Address matched",cases:[]}}} as unknown as DealProps;
  const priced=preliminaryCost(site,assumptions);
  assert.ok("layouts" in priced);
  assert.deepEqual(priced.layouts.map(l=>[l.stalls,l.ledger.inputs.price]),[[2,140000],[4,140000],[2,110000],[4,110000]]);
  const [lead]=priced.layouts;
  assert.ok(lead.ledger.hypothetical);
  assert.match(lead.ledger.validation!,/prices disagree/);
  assert.equal(lead.ledger.inputs.cash,0);
  const summary={result:{siteCost:null},preliminary:priced,screenAssumptions:assumptions} as unknown as ChargingSummary;
  assert.equal(displayedFit(site.chargingSpace,summary)?.count,null);
  assert.equal(listScreen({...site,charging:summary}).group,"conditional");
  assert.equal(listScreen({...site,charging:summary}).cost.value,costRange(lead));
  assert.ok("reason" in preliminaryCost({...site,opportunityReview:{...site.opportunityReview!,coverage:undefined}},assumptions));
  assert.ok("reason" in preliminaryCost(site,assumptions,{rights:"unavailable",terms:"purchase",values:{rent:null}}));
});

test("reviewed price and fit tests retain losses and identify availability triggers",()=>{
  const site={...deal,asking_price:null,purchase:{inputs:{cash:-500,ownership:"No"}},
    chargingSpace:{count:null,value:"Needs measurement",basis:"Unclear"},
    opportunityReview:{primary:{disposition:"Watch availability",route:"Offered acquisition"},coverage:{countyStatus:"Address matched",cases:[]},
      planningInputs:[{kind:"Stalls",value:1,label:"Released bay",validation:"Measure the opening.",source:"https://example.org/plan"},
      {kind:"Price",value:145000,label:"Historical price",validation:"Verify sale terms.",source:"https://example.org/terms"}]}} as unknown as DealProps;
  const priced=preliminaryCost(site,assumptions);
  assert.ok("layouts" in priced);
  const {ledger}=priced.layouts[0];
  assert.equal(ledger.inputs.stalls,1);assert.equal(ledger.inputs.cash,-500);
  const withRecast=preliminaryCost({...site,purchase:{...site.purchase!,inputs:{...site.purchase!.inputs,cash:null,normalized:-800}}},assumptions);
  assert.ok("layouts" in withRecast);
  assert.equal(withRecast.layouts[0].ledger.inputs.cash,-800);
  assert.match(withRecast.layouts[0].ledger.cashBasis,/normalized EBITDA/);
  assert.equal(ledger.source,"https://example.org/terms");
  assert.match(ledger.validation!,/becomes available.*opening.*sale terms/);
  assert.ok("reason" in preliminaryCost({...site,opportunityReview:{...site.opportunityReview!,primary:{...site.opportunityReview!.primary,disposition:"Service diligence"}}},assumptions));
});

test("a confirmed whole-site zero recommends drop after all alternatives are reviewed",async()=>{
  const {calculate}=await import("../../lib/charging/model");
  const c=initialCase(deal);
  c.values.stalls=0;c.allOptionsReviewed=true;
  c.evidence.stalls={status:"assumed",source:"One area",date:"2026-01-01"};
  assert.notEqual(calculate(c).decision,"Suggest drop");
  c.evidence.stalls={status:"verified",source:"Whole-parcel parking, open land and conversion review",date:"2026-01-01"};
  assert.equal(calculate(c).decision,"Suggest drop");
  c.allOptionsReviewed=false;
  assert.notEqual(calculate(c).decision,"Suggest drop");
});
