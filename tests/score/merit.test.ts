import {test} from "node:test";
import assert from "node:assert/strict";
import {allocate,emptyRanking,marketSequence,siteMerit} from "../../lib/charging/merit";
import {calculate,initialCase,keys} from "../../lib/charging/model";
import {validateInputs} from "../../lib/charging/schema";
import type {DealProps} from "../../lib/types";

const site={deal_id:"PIPE-PHX-9998",stage_blocker:"—",asking_price:0,bays_that_fit:4} as DealProps;
function example(){
  const c=initialCase(site);
  for(const k of keys){c.values[k]=0;c.evidence[k]={source:"Example exhibit",date:"2026-01-01",status:"verified"};}
  Object.assign(c.values,{stalls:4,days:300,weekdayHours:8,weekendHours:8,ownWeek:8,ownEnd:8,posts:1,wage:12,demand:6,
    supply:400,charger:100,energy:45,dwell:30,efficiency:95,uptime:95,peak:8,peakCover:8,years:5,depot:20,rate:10,energyRate:0.18});
  Object.assign(c,{rights:"controlled",rightsSource:"Floor plan",rightsDate:"2026-01-01",comparable:true,comparator:"local",energyScope:"included",
    openEarly:"2027-02-01",openLate:"2027-03-01"});
  c.ranking={...emptyRanking,valuationDate:"2027-01-01",pool:"A",source:"Joint operating stress and dispatch plan",date:"2026-01-01",needBy:"2027-04-01",annualNeed:14400,peakNeed:48,avoided:19,downside:{fixed:1000}};
  return c;
}
test("only a current documented matched case qualifies, including exact parity",()=>{
  const c=example(); assert.ok(validateInputs(c).success);
  const evalSite=()=>siteMerit(site,c,true,false,false);
  assert.equal(evalSite().action,"Advance diligence");
  delete c.ranking!.downside.fixed;c.ranking!.downside={fixed:0};
  c.values.depot=calculate(c).siteCost!;c.ranking!.avoided=c.values.depot;
  assert.equal(evalSite().action,"Advance diligence");
  assert.ok(Math.abs(evalSite().netValue!)<1e-7);
  assert.equal(siteMerit(site,c,true,true,false).netValue,null);
  delete c.evidence.load;assert.equal(evalSite().netValue,null);
  c.ranking!.downside={stalls:4.5};assert.equal(validateInputs(c).success,false);
  delete c.ranking;assert.ok(validateInputs(c).success);
});
test("market sequence consumes shared demand including ties without using other markets",()=>{
  const compute=()=>siteMerit(site,example(),true,false,false);
  const m=compute();assert.ok(m.netValue!>0);
  const n=m.network!;assert.equal(allocate(n,0,0),null);
  const res=marketSequence(["B","C","A"].map((id,i)=>({id,city:i===1?"LAS":"PHX",merit:m})));
  assert.deepEqual([...res.keys()].sort(),["A","C"]);assert.equal(res.get("A")?.rank,1);
  assert.equal(res.get("C")?.value,m.netValue);
});
test("a proxy, zero throughput, insufficient residual demand and current blockers prevent a rank",()=>{
  const c=example();
  assert.equal(siteMerit({...site,chargingHold:"Verify operating rights."},c,true,false,false).netValue,null);
  c.ranking!.peakNeed=0;assert.equal(siteMerit(site,c,true,false,false).netValue,null);
  c.comparator="workbook";assert.equal(siteMerit(site,c,true,false,false).netValue,null);
  c.comparator="local";c.values.supply=0;assert.equal(siteMerit(site,c,true,false,false).netValue,null);
});

test("dated alternatives discount deferred costs and consume a shared obligation once",()=>{
  const c=example();
  const n=c.ranking!;
  n.schedule={key:"Shared equipment",source:"Illustrative lease",flows:[
    {date:"2027-03-01",without:20000,withSite:0},
    {date:"2028-03-01",without:0,withSite:20000},
  ]};
  const m=siteMerit(site,c,true,false,false);
  assert.ok(m.network);
  const before=m.netValue!;
  const used=allocate(m.network,undefined,undefined,new Set(["shared equipment"]))!;
  assert.ok(before-used.value>1500 && before-used.value<2000);
  const other={...m,network:{...m.network,pool:"disjoint"}};
  const ranks=marketSequence([{id:"A",city:"PHX",merit:m},{id:"B",city:"PHX",merit:other}]);
  assert.equal(ranks.get("A")?.value,before);
  assert.equal(ranks.get("B")?.value,used.value);
  const incompatible={...other,network:{...other.network,rate:0.15}};
  assert.equal(marketSequence([{id:"A",city:"PHX",merit:m},{id:"B",city:"PHX",merit:incompatible}]).size,0);
  n.schedule.flows[1].withSite=null;
  assert.equal(siteMerit(site,c,true,false,false).netValue,null);
});
test("the workbook projects the app decision and preserves zero and blank rank",async()=>{
  const {chargingMirrorRows}=await import("../../scripts/charging-mirror");
  const {summarize}=await import("../../lib/charging/summary");
  const {modelVersion}=await import("../../lib/charging/model");
  const c=example(), result=calculate(c);
  const rev="approved-base";
  c.values.depot=result.siteCost!;c.ranking!.downside={fixed:c.values.fixed!};c.ranking!.avoided=c.values.depot;
  const saved={id:"illustration",site_id:site.deal_id,revision:1,name:"Paid shifts",author:"Example",at:"2027-01-01",
    model:modelVersion,sourceRevision:rev,inputs:c,result:calculate(c),selected:true};
  const fresh=summarize(site,rev,saved),cells:string[]=[];
  cells[88]=site.deal_id;cells[4]="1 Desk screen";
  const table={headerRow:4,title:"Pipeline",headers:[],rows:[{row:18,cells,formulas:[]}]};
  const sheet=(s:typeof fresh)=>chargingMirrorRows(table,[saved],new Map([[site.deal_id,s]]))[1];
  const row=sheet(fresh);assert.equal(row[17],fresh.merit.action);assert.equal(row[22],1);
  assert.ok(Math.abs(Number(row[23]))<1e-7);assert.notEqual(row[23],"");
  const stale=sheet(summarize(site,"new-base",saved));assert.equal(stale[22],"");assert.equal(stale[23],"");
});
