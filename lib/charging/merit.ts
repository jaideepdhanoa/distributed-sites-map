import type { DealProps } from "../types";
import { calculate, fields, type Inputs, type Key } from "./model";

export const meritVersion = "site-merit/1";
export const downsideKeys = ["stalls","supply","load","demand","dwell","uptime","conversion","interruption","loss","cash","upgrade","build","fixed","hostWeek","hostEnd","ownWeek","ownEnd","hostFee","posts","wage","energyRate","demandRate","billedPeak"] as const;
export type DownsideKey = typeof downsideKeys[number];
export type NetworkFlow = { date:string; without:number|null; withSite:number|null };
export type CashSchedule = { key:string; source:string; flows:NetworkFlow[] };
export type RankingInputs = {
  valuationDate?:string; schedule?:CashSchedule;
  pool: string; source: string; date: string; needBy: string;
  annualNeed: number|null; peakNeed: number|null; avoided: number|null;
  downside: Partial<Record<DownsideKey,number>>;
  checkDays: number|null; checkCost: number|null;
};
export const emptyRanking:RankingInputs = {pool:"",source:"",date:"",needBy:"",annualNeed:null,peakNeed:null,avoided:null,downside:{},checkDays:null,checkCost:null};
export const actionColors = {
  "Advance diligence":"#387156", "Verify a condition":"#a8711b", "Reprice":"#385a7a",
  "Evidence needed":"#827a70", "Review for closure":"#9e4b3e",
};
type Action=keyof typeof actionColors;
type LoadCase = {sessions:number; peak:number; annualFixed:number; variable:number};
export type NetworkCase = {
  pool:string; annualNeed:number; peakNeed:number; avoided:number; years:number; rate:number; depot:number;
  base:LoadCase; downside:LoadCase; yearOne:number;
  valuationDate?:string; opening?:string; sessionKwh?:number; schedule?:CashSchedule;
};
export type Merit = {
  version:string; action:Action; next:string; order:number; checkCost:number|null; checkDays:number|null;
  downsideGap:number|null; downsideCeiling:number|null; netValue:number|null; servedPeak:number|null; network:NetworkCase|null;
};
function loadCase(c:Inputs):LoadCase|null {
  const r=calculate(c);
  if(!r.sessions || !r.peakSessions || r.siteCost==null)return null;
  const v=c.values;
  const variable=c.energyScope==="included"? v.energy! * v.energyRate! / (v.efficiency!/100):0;
  return {sessions:r.sessions,peak:r.peakSessions,annualFixed:(r.siteCost-variable)*r.sessions,variable};
}
// Use a common operating profile for the residual annual and peak demand.
// Fixed annual equivalent already includes capital recovery. Discount it once.
const yearsBetween=(start:string,end:string)=>(Date.parse(end)-Date.parse(start))/(365.25*86400000);
function cashScheduleReady(n:RankingInputs, opening:string, years:number) {
  const schedule=n.schedule;
  if(!schedule)return true;
  return Boolean(schedule.key.trim() && schedule.source.trim() && schedule.flows.length &&
    schedule.flows.every(f=>f.date>=opening && yearsBetween(opening,f.date)<=years && f.without!=null && f.withSite!=null));
}
export function allocate(n:NetworkCase,annualNeed=n.annualNeed,peakNeed=n.peakNeed,usedCash=new Set<string>()) {
  function atLoad(c:LoadCase) {
    const share=Math.max(0,Math.min(1,annualNeed/c.sessions,peakNeed/c.peak));
    const annual=c.sessions*share, peak=Math.floor(c.peak*share+1e-9);
    const cost=annual>0 ? c.annualFixed/annual+c.variable : null;
    return {annual,peak,cost};
  }
  const b=atLoad(n.base),d=atLoad(n.downside);
  if(!b.peak || !d.peak || b.cost==null || d.cost==null || Math.max(b.cost,d.cost)>n.depot+1e-8)return null;
  const discount=n.rate===0?n.years:-Math.expm1(-n.years*Math.log1p(n.rate))/n.rate;
  const lag=n.opening && n.valuationDate ? yearsBetween(n.valuationDate,n.opening) : 0;
  let value=(n.avoided-d.cost)*d.annual*discount/Math.pow(1+n.rate,lag);
  const schedule=n.schedule;
  const key=schedule?.key.trim().toLowerCase();
  // A documented fixed cancellation or deferral requires the complete downside service.
  // At partial utilization its future payments stay in the counterfactual.
  const cashKey=key && !usedCash.has(key) && d.annual>=n.downside.sessions-1e-8 && d.peak>=n.downside.peak ? key : null;
  if(cashKey && schedule && n.valuationDate){
    for(const flow of schedule.flows){
      value+=(flow.without!-flow.withSite!)/Math.pow(1+n.rate,yearsBetween(n.valuationDate,flow.date));
    }
  }
  return value>=-1e-7 ? {value:Math.max(0,value),annual:d.annual,peak:d.peak,cashKey}:null;
}

export function siteMerit(deal:DealProps,c:Inputs,selected:boolean,stale:boolean,conditional:boolean):Merit {
  const v=c.values, r=calculate(c), n=c.ranking;
  const check=deal.selectionResearch?.check || deal.screening?.instruction || r.next;
  const m:Merit={version:meritVersion,action:"Evidence needed",next:check,order:5,checkCost:n?.checkCost??null,checkDays:n?.checkDays??null,
    downsideGap:null,downsideCeiling:null,netValue:null,servedPeak:null,network:null};
  const downside=n && Object.keys(n.downside).length ? {...c,values:{...v,...n.downside}} : null;
  const stress=downside ? calculate(downside) : null;
  if(selected && !stale && stress){
    m.downsideGap=stress.difference;
    m.downsideCeiling=stress.offer;
  }
  function result(action:Action,next:string,order:number):Merit {return {...m,action,next,order};}
  if(deal.suggested_drop || deal.listing_removed)return result("Review for closure",deal.suggested_drop || "Reconcile the offering and current disposition.",7);
  const commercial=deal.opportunityReview?.primary;
  if(commercial?.disposition==="Suggest drop")return result("Review for closure",commercial.rationale,7);
  if(commercial){
    const siteHold=["Previously dropped","Outside mandate"].includes(commercial.disposition);
    const closed=["Close offering","Watch availability","Archive listing","Off-market prospect"].includes(commercial.disposition);
    const routeApplies=c.terms==="purchase" ? ["Operating acquisition","Offered acquisition","Property only"].includes(commercial.route)
      : ["Operating lease","Host agreement"].includes(commercial.route);
    if(siteHold || (closed && routeApplies))return result("Verify a condition",commercial.next,2);
  }
  const blocker=deal.stage_blocker?.trim();
  if(blocker && !/^(?:—|-|unknown|n\/a|none|not on file)$/i.test(blocker))return result("Verify a condition",blocker,2);
  if(deal.chargingHold)return result("Verify a condition",deal.chargingHold,2);
  const gate=deal.screening?.priority;
  if(gate && ["Check disposition","Resolve site rights","Check service area","Confirm operating business","Resolve parcel","Outside mandate","Land paused"].includes(gate))
    return result("Verify a condition",deal.screening!.instruction,2);
  if(stale)return result("Verify a condition","Refresh the selected revision against the latest site evidence.",2);
  if(!selected)return result(conditional?"Verify a condition":"Evidence needed",check,conditional?1:5);
  if(c.rights==="unavailable" && r.decision==="Recommend closing")return result("Review for closure",r.next,7);
  if(c.rights!=="controlled" || !c.rightsDate || !c.rightsSource.trim())return result("Verify a condition",check,conditional?1:3);
  if(c.comparator!=="local" || !c.comparable || c.energyScope!=="included")
    return result("Verify a condition","Obtain the local depot comparison including energy and demand charges on a matching session basis.",2);
  const known=(key:Key)=>!!c.evidence[key]?.date && !!c.evidence[key]?.source.trim() && c.evidence[key]?.status!=="assumed";
  const required:Key[]=["stalls","days","supply","load","charger","demand","energy","efficiency","dwell","uptime","peak","peakCover","weekdayHours","weekendHours","ownWeek","ownEnd","hostWeek","hostEnd","build","upgrade","conversion","interruption","cash","loss","fixed","tax","rate","years","depot","energyRate","demandRate","billedPeak"];
  required.push(c.terms==="purchase"?"ask":"rent");
  if(c.terms==="purchase")required.push("closing");
  if(v.ownWeek || v.ownEnd)required.push("wage","posts");
  if(v.hostWeek || v.hostEnd)required.push("hostFee");
  const gap=required.find(k=>v[k]==null || !known(k));
  if(gap)return result("Verify a condition","Document "+fields[gap].label+" for this layout.",2);
  if(r.decision==="Recommend closing")return result("Review for closure",r.next,7);
  if((v.stalls??0)<4 || !r.peakSessions || r.difference==null)return result("Verify a condition","Verify a controlled four-stall layout and completed sessions in the required shift.",3);
  const terms=c.terms==="purchase"?v.ask:v.rent;
  if(c.terms==="purchase" && v.assetCap!=null && terms!=null && terms>v.assetCap)
    return result("Reprice","Verify independent asset support and renegotiate the purchase terms.",2);
  if(r.difference>1e-8){
    if(r.annualGap>0 || r.ceiling==null)return result("Verify a condition",r.next,2);
    if(v.floorTerms==null || !known("floorTerms") || v.floorTerms>r.ceiling)
      return result("Verify a condition","Establish attainable terms against the parity ceiling.",2);
    return result("Reprice",r.next,2);
  }
  if(!n?.source.trim() || !n.date || !stress || !downside)return result("Verify a condition","Record a sourced joint downside for this layout and staffing schedule.",1);
  if(stress.difference!=null && stress.difference+1e-8<r.difference)
    return result("Verify a condition","Review the joint downside. It improves unit cost relative to the working case.",1);
  if(stress.difference==null || stress.difference>1e-8 || (downside.values.stalls??0)<4)
    return result("Verify a condition","The joint downside does not clear physical fit and parity. Verify the downside or renegotiate terms.",1);
  if(!n.pool.trim() || !n.needBy || !c.openEarly || !c.openLate || c.openLate>n.needBy || n.peakNeed==null || n.annualNeed==null || n.avoided==null)
    return result("Verify a condition","Document dispatch demand after committed chargers, need date, opening window and avoidable local cost.",1);
  if(!n.valuationDate || n.valuationDate>c.openLate)
    return result("Verify a condition","Enter the common market valuation date on or before the conservative opening date.",1);
  if(!cashScheduleReady(n,c.openLate,v.years!))
    return result("Verify a condition","Complete the sourced with-site and without-site cash schedule for the operating horizon.",1);
  const base=loadCase(c),low=loadCase(downside);
  if(!base || !low || stress.yearOne==null)return result("Verify a condition","Establish peak service in both cases.",2);
  m.network={pool:n.pool.trim().toLowerCase(),annualNeed:n.annualNeed,peakNeed:n.peakNeed,avoided:n.avoided,years:v.years!,rate:v.rate!/100,
    depot:v.depot!,base,downside:low,yearOne:stress.yearOne,valuationDate:n.valuationDate,opening:c.openLate,sessionKwh:v.energy!,schedule:n.schedule};
  const benefit=allocate(m.network);
  if(!benefit)return result("Verify a condition","Confirm enough residual peak demand and avoidable costs to support this investment.",2);
  m.netValue=benefit.value; m.servedPeak=benefit.peak;
  return result("Advance diligence","Review the downside offer ceiling, funding and closing conditions.",0);
}

export function diligenceOrder(a?:Merit,b?:Merit) {
  const unknown=Number.MAX_SAFE_INTEGER;
  return (a?.order??8)-(b?.order??8) || (a?.checkCost??unknown)-(b?.checkCost??unknown) || (a?.checkDays??unknown)-(b?.checkDays??unknown);
}
type Candidate={id:string;city:string;merit?:Merit};
export function incompatibleMarkets(rows:Candidate[]) {
  const basis=new Map<string,Set<string>>();
  for(const row of rows){
    const n=row.merit?.network;
    if(!n || row.merit?.netValue==null)continue;
    const keys=basis.get(row.city)??new Set<string>();
    keys.add([n.valuationDate,n.rate,n.years,n.sessionKwh].join("|"));
    basis.set(row.city,keys);
  }
  return new Set([...basis].filter(([,keys])=>keys.size>1).map(([city])=>city));
}
// Greedy sequence within a market. Alternatives in the same dispatch pool share
// the conservative minimum of their documented residual demand estimates.
export function marketSequence(rows:Candidate[]) {
  const ranks=new Map<string,{rank:number;value:number;peak:number}>();
  const incompatible=incompatibleMarkets(rows);
  for(const city of new Set(rows.map(r=>r.city))){
    if(incompatible.has(city))continue;
    const usedCash=new Set<string>();
    const remaining=rows.filter(r=>r.city===city && r.merit?.netValue!=null && r.merit.network);
    const pools=new Map<string,{annual:number;peak:number}>();
    for(const row of remaining){
      const n=row.merit!.network!, p=pools.get(n.pool);
      pools.set(n.pool,{annual:Math.min(n.annualNeed,p?.annual??Infinity),peak:Math.min(n.peakNeed,p?.peak??Infinity)});
    }
    let rank=0;
    while(remaining.length){
      const candidates=remaining.flatMap(row=>{
        const n=row.merit!.network!,p=pools.get(n.pool)!,a=allocate(n,p.annual,p.peak,usedCash);
        return a?[{row,n,p,a}]:[];
      }).sort((a,b)=>b.a.value-a.a.value || b.a.peak-a.a.peak || a.n.yearOne-b.n.yearOne || a.row.id.localeCompare(b.row.id));
      const first=candidates[0];if(!first)break;
      ranks.set(first.row.id,{rank:++rank,value:first.a.value,peak:first.a.peak});
      if(first.a.cashKey)usedCash.add(first.a.cashKey);
      first.p.annual-=first.a.annual;first.p.peak-=first.a.peak;
      remaining.splice(remaining.indexOf(first.row),1);
    }
  }
  return ranks;
}
