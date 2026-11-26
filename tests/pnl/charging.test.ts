import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initialCase,calculate,keys,type Inputs } from "../../lib/charging/model";
import { networkReference } from "../../lib/charging/reference";
import { saveCase,caseHistory,activeCases } from "../../lib/charging/store";
import { validateInputs } from "../../lib/charging/schema";
import { migrate } from "../../lib/actions/migrate";
import { memorySql } from "../helpers/sql";
import type { DealProps } from "../../lib/types";
function example():Inputs {
  const c=initialCase({asking_price:0,bays_that_fit:4});
  for(const key of keys)c.values[key]=0;
  Object.assign(c.values,{stalls:4,days:365,weekdayHours:10,weekendHours:10,ownWeek:10,ownEnd:10,posts:1,wage:20,
    supply:400,charger:100,dwell:30,energy:40,efficiency:100,uptime:100,demand:6,peak:8,peakCover:8,
    depot:10,years:10,ask:100000,shortfall:40});
  c.rights="controlled";c.rightsSource="Measured exhibit";c.rightsDate="2026-01-15";c.openEarly="2027-04-01";c.openLate="2027-05-01";c.depotDate="2027-06-01";
  return c;
}
test("one site limits sessions by service, usable stalls, staffed hours and demand",()=>{
  const c=example(),r=calculate(c);
  assert.equal(r.sessions,21900);assert.equal(r.peakSessions,48);assert.equal(r.earlyMin,1240);
  c.values.supply=100;assert.equal(calculate(c).sessions,9125);
  c.values.ownWeek=5;assert.ok(calculate(c).sessions! < 9125);
  c.values.supply=null;assert.equal(calculate(c).siteCost,null);
  c.values.supply=0;assert.equal(calculate(c).sessions,0);assert.equal(calculate(c).ceiling,null);
});
test("parity price, unknown ask, host fees, interruption and permission to use a layout",()=>{
  const c=example();c.values.ask=calculate(c).ceiling;
  assert.ok(Math.abs(calculate(c).difference!)<1e-8);
  c.values.ask=null;assert.equal(calculate(c).siteCost,null);assert.ok(calculate(c).ceiling!>0);
  c.terms="lease";c.values.rent=0;const rent=calculate(c).ceiling!;
  c.values.loss=12000;assert.equal(calculate(c).ceiling,rent-1000);
  c.values.hostWeek=5;c.values.ownWeek=5;c.values.hostFee=2;
  assert.ok(calculate(c).hostLimit!>2);
  c.values.loss=1e8;assert.equal(calculate(c).ceiling,0);assert.ok(calculate(c).annualGap>0);
  c.rights="unavailable";assert.equal(calculate(c).decision,"Verify a condition");
  c.allOptionsReviewed=true;assert.equal(calculate(c).decision,"Suggest drop");
});
test("reference matches the filed network and independently prices host labor and conversion",()=>{
  const c=example();Object.assign(c.values,{ask:100,hostWeek:12,hostEnd:12,ownWeek:12,ownEnd:12});
  const deal={selectionResearch:{quote:100,cases:[{stalls:4,base:0.1}]},purchase:{assumptions:{hub:1000000,horizon:10,demand:12,closing:0,capital:0.1,
    charging:{charges:100000,attendant:20000,escalation:10,tax:0,hostHours:12,perPost:10}}}} as unknown as DealProps;
  assert.equal(networkReference(deal,c)?.cost,9);
  Object.assign(c.values,{hostWeek:0,hostEnd:0,ownWeek:24,ownEnd:24});assert.equal(networkReference(deal,c)?.cost,12);
  c.values.conversion=10000;c.values.loss=1000;assert.equal(networkReference(deal,c)?.cost,12.6);
});
test("saved history reopens exactly, rejects stale revisions and retains the selected case",async()=>{
  const sql=await memorySql();await migrate(sql);
  const input={id:randomUUID(),requestId:randomUUID(),base:0,name:"Paid coverage",inputs:example(),sourceRevision:"aaaaaaaaaaaaaaaaaaaaaaaa",select:true,expectedSelection:null};
  const site="PIPE-PHX-9998";
  assert.ok(validateInputs(input.inputs).success);
  let rows=await saveCase(sql,site,"reviewer",input);assert.equal(rows.length,1);assert.equal(rows[0].selected,true);
  assert.equal((await saveCase(sql,site,"reviewer",input)).length,1);
  await assert.rejects(saveCase(sql,site,"reviewer",{...input,name:"Different"}),/conflicts/);
  await assert.rejects(saveCase(sql,site,"reviewer",{...input,requestId:randomUUID()}),/newer revision/);
  rows=await saveCase(sql,site,"second",{...input,requestId:randomUUID(),base:1,name:"Revised",expectedSelection:input.id+":1"});
  assert.equal(rows.length,2);assert.equal((await activeCases(sql))[0].revision,2);assert.equal((await caseHistory(sql,site))[0].author,"second");
});

test("an unpriced offering stays unknown and avoids borrowing an unrelated workbook price",()=>{
  const site={asking_price:10000,selectionResearch:{quote:null,cases:[]}} as unknown as DealProps;
  assert.equal(initialCase(site).values.ask,null);
  assert.equal(initialCase({asking_price:0}).values.ask,0);
});
test("billed peak, temporary replacement and the upgrade threshold have distinct units",()=>{
  const c=example();c.energyScope="included";Object.assign(c.values,{energyRate:0.1,demandRate:5,billedPeak:20,temporary:5000});
  c.temporaryEnd="2027-06-01";c.temporarySource="Dated replacement example";
  const initial=calculate(c);assert.ok(initial.avoidedTemp!>0);assert.ok(initial.neededSessions!>0);
  c.values.billedPeak=40;
  assert.ok(Math.abs((calculate(c).siteCost!-initial.siteCost!)*initial.sessions!-1200)<0.00001);
  c.values.upgrade=calculate(c).upgradeLimit;assert.ok(Math.abs(calculate(c).difference!)<1e-8);
  c.temporarySource="";assert.equal(calculate(c).avoidedTemp,null);
});

import {changeValue,reviseSource,sourceValue} from "../../lib/charging/evidence";
import type {CalculationTrace} from "../../lib/charging/model";
test("the explanation reconciles each annual line and the binding hourly capacity",()=>{
  const c=example();
  for(const terms of ["purchase","lease"] as const)for(const energyScope of ["included","excluded"] as const){
    c.terms=terms;c.energyScope=energyScope;
    Object.assign(c.values,{rent:3000,build:75000,conversion:10000,interruption:3200,loss:4000,cash:12000,tax:1.2,
      rate:7,energyRate:.17,billedPeak:110,demandRate:4,closing:3,fixed:8000});
    const trace:CalculationTrace={annual:[],throughput:[],total:null,hours:null,perHour:null};
    const result=calculate(c,trace);
    const total=trace.annual.reduce((sum,line)=>sum+(line.value??0),0);
    assert.ok(Math.abs(total-trace.total!)<1e-7);
    assert.ok(Math.abs(total/result.sessions!-result.siteCost!)<1e-9);
    assert.equal(trace.throughput.find(line=>line.value===trace.perHour)?.label,"Fleet demand");
    assert.equal(trace.hours!*trace.perHour!,result.sessions);
    assert.equal(trace.annual.find(line=>line.label.includes("Electricity"))?.excluded,energyScope==="excluded");
    c.values.fixed=null;assert.equal(calculate(c,trace).siteCost,null);assert.equal(trace.total,null);
    assert.equal(trace.annual.find(line=>line.label.startsWith("Upkeep"))?.value,null);
    c.values.fixed=0;calculate(c,trace);assert.equal(trace.annual.find(line=>line.label.startsWith("Upkeep"))?.value,0);
  }
});
test("a saved quote survives trials, edits to the underlying source, copies and review attribution",async()=>{
  const c=example();delete c.sourceValues;
  const quoted={status:"quoted" as const,source:"Synthetic contractor estimate",date:"2026-11-01",reviewer:"reviewer"};
  c.evidence.conversion=quoted;c.values.conversion=18000;
  const first=changeValue(c,"conversion",25000),second=changeValue(first,"conversion",30000);
  assert.deepEqual(sourceValue(second,"conversion"),{value:18000,evidence:quoted});
  assert.equal(second.evidence.conversion?.status,"assumed");assert.ok(validateInputs(second).success);
  assert.deepEqual(changeValue(second,"conversion",18000).evidence.conversion,quoted);
  const updated=reviseSource(second,"conversion",20000,{...quoted,date:"2026-11-10"});
  assert.equal(updated.values.conversion,30000);assert.equal(updated.sourceValues?.conversion?.value,20000);
  const invalid={...second,evidence:{...second.evidence,conversion:quoted}};assert.equal(validateInputs(invalid).success,false);
  const sql=await memorySql();await migrate(sql);
  const site="PIPE-PHX-9998",input={id:randomUUID(),requestId:randomUUID(),base:0,name:"Quote test",inputs:second,sourceRevision:"aaaaaaaaaaaaaaaaaaaaaaaa",select:false,expectedSelection:null};
  await assert.rejects(saveCase(sql,site,"different",input),/reviewer/);
  await saveCase(sql,site,"reviewer",input);
  const rows=await saveCase(sql,site,"different",{...input,id:randomUUID(),requestId:randomUUID()});
  assert.equal(rows[0].inputs.sourceValues?.conversion?.evidence.reviewer,"reviewer");assert.equal((await activeCases(sql)).length,0);
});

test("a dated public asking quote retains its document and scope while workbook amounts remain assumptions",()=>{
  const research={quote:125000,basis:"Public quote; scope restricted or unresolved",source:"https://example.org/offering",reviewedOn:"2026-01-07"};
  const site={selectionResearch:research} as unknown as DealProps;
  const c=initialCase(site);
  assert.deepEqual(c.evidence.ask,{status:"quoted",source:research.basis,url:research.source,date:research.reviewedOn});
  assert.equal(sourceValue(changeValue(c,"ask",100000),"ask").evidence.url,research.source);
  research.basis="Workbook asking price";
  assert.equal(initialCase(site).evidence.ask?.status,"assumed");
});
