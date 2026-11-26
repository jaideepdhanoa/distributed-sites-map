import type { DealProps } from "../types";

export const modelVersion = "site-parity/1";
export const groups = ["Layout and opening", "Power and throughput", "Staffing", "Conversion and cash", "Deal and depot"] as const;
type Group = typeof groups[number];
function field(label: string, group: Group, max = 1e10, min = 0) { return {label, group, min, max}; }
export const fields = {
  stalls:field("Usable stalls",groups[0],200), days:field("Operating days per year",groups[0],365),
  weekdayHours:field("Required charging hours per weekday",groups[2],24), weekendHours:field("Required charging hours per weekend day",groups[2],24),
  hostWeek:field("Host coverage hours per weekday",groups[2],24), hostEnd:field("Host coverage hours per weekend day",groups[2],24),
  ownWeek:field("Moove coverage hours per weekday",groups[2],24), ownEnd:field("Moove coverage hours per weekend day",groups[2],24),
  posts:field("Attendants per staffed shift",groups[2],100), wage:field("Moove loaded cost per attendant-hour ($)",groups[2]),
  hostFee:field("Host fee or backfill per covered hour ($)",groups[2]),
  supply:field("Available service after upgrades (kW)",groups[1]), load:field("Existing coincident peak load (kW)",groups[1]),
  charger:field("Delivered charger power per stall (kW)",groups[1]), energy:field("Delivered energy per session (kWh)",groups[1]),
  dwell:field("Minutes occupying stall per session",groups[1]), efficiency:field("Grid-to-vehicle efficiency (%)",groups[1],100),
  uptime:field("Charging availability (%)",groups[1],100), demand:field("Fleet sessions needed per staffed hour",groups[1]),
  peak:field("Required peak shift length (hours)",groups[1],24), peakCover:field("Staffed hours overlapping the peak",groups[1],24),
  energyRate:field("Electricity ($/kWh from grid)",groups[1]), demandRate:field("Demand charge ($/kW per month)",groups[1]),
  build:field("Charging build cost ($)",groups[3]), upgrade:field("Utility upgrade cost ($)",groups[3]),
  conversion:field("Additional conversion works ($ once)",groups[3]), interruption:field("One-time interruption loss ($)",groups[3]),
  cash:field("Operating cash retained before displacement ($/year)",groups[3],1e10,-1e10), loss:field("Additional displaced margin ($/year)",groups[3]),
  fixed:field("Annual charging upkeep, insurance and supervision ($)",groups[3]), tax:field("Annual tax on infrastructure (%)",groups[3],100),
  ask:field("Purchase price ($)",groups[4]), rent:field("Monthly rent ($)",groups[4]), assetCap:field("Independent asset-value cap ($)",groups[4]),
  rate:field("Cost of capital (%)",groups[4],100), closing:field("Purchase closing costs (%)",groups[4],100),
  years:field("Analysis horizon / lease term (years)",groups[4],100), depot:field("Comparable depot cost ($/charge)",groups[4]),
  shortfall:field("Unserved fleet sessions per day before depot opens",groups[0]),
};
export type Key = keyof typeof fields;
export type Evidence = {status:"assumed"|"quoted"|"verified"; source:string; date:string};
export type Inputs = {
  values:Record<Key,number|null>; evidence:Partial<Record<Key,Evidence>>;
  layout:string; rights:"unknown"|"controlled"|"unavailable"; rightsSource:string;
  terms:"purchase"|"lease"; comparator:"workbook"|"local"; energyScope:"excluded"|"included";
  openEarly:string; openLate:string; depotDate:string; allOptionsReviewed:boolean;
};
export const keys = Object.keys(fields) as Key[];
export type Assumptions = Partial<Record<"charges"|"unitBuild"|"attendant"|"perPost"|"kw"|"fixed"|"insurance"|"perCharger"|"ports"|"upgrade"|"tax"|"hostHours"|"escalation",number|null>>;
export const amounts = (n:number|null, digits = 0) => n == null ? "Unknown" : n.toLocaleString("en-US",{style:"currency",currency:"USD",minimumFractionDigits:digits,maximumFractionDigits:digits});
export function initialCase(d: Pick<DealProps,"purchase"|"selectionResearch"|"asking_price"|"bays_that_fit">):Inputs {
  const w=d.purchase?.inputs, a=d.purchase?.assumptions, ref=a?.charging;
  const values = Object.fromEntries(keys.map(k=>[k,null])) as Inputs["values"];
  const stalls=w?.fit ?? d.bays_that_fit ?? w?.stalls ?? null;
  Object.assign(values,{stalls, days:365, hostWeek:0,hostEnd:0,ownWeek:24,ownEnd:24,weekdayHours:24,weekendHours:24,
    hostFee:0, posts:stalls!=null && ref?.perPost ? Math.ceil(stalls/ref.perPost) : null,
    wage:ref?.attendant!=null ? ref.attendant/(365*24) : null, charger:ref?.kw ?? null,
    conversion:0,interruption:0,loss:0, ask:d.selectionResearch?.cases.length ? d.selectionResearch.quote : d.asking_price ?? w?.ask ?? null,
    cash:w?.cash ?? null,assetCap:w?.landCap ?? null,build:ref?.unitBuild!=null && stalls!=null ? stalls*ref.unitBuild : null,
    tax:ref?.tax!=null ? ref.tax*100:null,rate:a?.capital!=null ? a.capital*100:null,closing:a?.closing!=null ? a.closing*100:null,
    years:a?.horizon ?? null, depot:a?.hub!=null && ref?.charges ? a.hub/ref.charges : null});
  const evidence:Inputs["evidence"]={};
  for(const key of keys) if(values[key]!=null) {
    const planning=(["days","hostWeek","hostEnd","ownWeek","ownEnd","weekdayHours","weekendHours","hostFee","conversion","interruption","loss"] as Key[]).includes(key);
    evidence[key]={status:"assumed",source:planning?"Planning assumption":key==="ask" && d.selectionResearch?.cases.length ? d.selectionResearch.basis : "Workbook screening input",date:planning?"":(key==="ask"?d.selectionResearch?.reviewedOn:"") || w?.checked || ""};
  }
  return {values,evidence,layout:"Workbook footprint",rights:"unknown",rightsSource:"",terms:"purchase",comparator:"workbook",energyScope:"excluded",openEarly:"",openLate:"",depotDate:"",allOptionsReviewed:false};
}
export const decisions=["Evidence needed","Verify a condition","Reprice","Advance diligence","Recommend closing"] as const;
export type Decision=typeof decisions[number];
export function calculate(c:Inputs) {
  const v=c.values, missing:string[]=[];
  function need(key:Key, positive=false) {
    const x=v[key];
    if(x===null || !Number.isFinite(x) || (positive && x<=0)) {missing.push(fields[key].label);return 0;}
    return x;
  }
  const hours=(host:number,own:number,required:number)=>Math.min(required,host+own);
  const week=need("weekdayHours"),end=need("weekendHours"),hostWeek=need("hostWeek"),hostEnd=need("hostEnd"),ownWeek=need("ownWeek"),ownEnd=need("ownEnd");
  const days=need("days",true), coveredWeek=hours(hostWeek,ownWeek,week),coveredEnd=hours(hostEnd,ownEnd,end);
  if(hostWeek+ownWeek>week || hostEnd+ownEnd>end) missing.push("Align host and Moove coverage with the required hours");
  const operatingHours=days*(5*coveredWeek+2*coveredEnd)/7;
  const delivered=need("energy",true), efficiency=need("efficiency",true)/100, stalls=need("stalls"),supply=need("supply"),siteLoad=need("load"),charger=need("charger",true);
  const kw=Math.min(Math.max(0,supply-siteLoad)*efficiency,stalls*charger);
  const dwell=need("dwell",true), demand=need("demand"), uptime=need("uptime")/100;
  const perHour=Math.min(demand,stalls*60/dwell,kw/delivered)*uptime;
  const throughputKnown=missing.length===0;
  const sessions=throughputKnown?operatingHours*perHour:null;
  const peakHours=v.peak!=null && v.peakCover!=null ? Math.min(v.peak,v.peakCover,Math.max(coveredWeek,coveredEnd)) : null;
  const peakSessions=throughputKnown && peakHours!=null ? Math.floor(peakHours*perHour) : null;
  const hostAnnual=days*(5*hostWeek+2*hostEnd)/7;
  const ownAnnual=days*(5*ownWeek+2*ownEnd)/7;
  const labor=(ownAnnual ? ownAnnual*need("posts",true)*need("wage") : 0)+(hostAnnual ? hostAnnual*need("hostFee") : 0);
  const rate=need("rate")/100, term=need("years",true);
  const recovery=rate===0 ? 1/term : rate/(1-Math.pow(1+rate,-term));
  const capital=need("build")+need("upgrade")+need("conversion"), interruption=need("interruption");
  const retained=need("cash")-need("loss"), fixed=need("fixed"),tax=need("tax")/100;
  const utility=c.energyScope==="included" ? (sessions??0)*delivered/efficiency*need("energyRate") + (efficiency>0 ? kw/efficiency : 0)*12*need("demandRate") : 0;
  const beforeProperty=(capital+interruption)*recovery+capital*tax+fixed+utility+labor-retained;
  const closing=c.terms==="purchase"?need("closing")/100:0;
  const factor=c.terms==="purchase" ? recovery*(1+closing):12;
  const price=c.terms==="purchase"?v.ask:v.rent;
  const siteCost=sessions && sessions>0 && !missing.length && price!=null ? (beforeProperty+price*factor)/sessions:null;
  const depot=need("depot",true);
  const room=sessions && sessions>0 && !missing.length ? depot*sessions-beforeProperty:null;
  const ceiling=room==null?null:Math.max(0,room/factor);
  const offer=ceiling==null?null:c.terms==="purchase" && v.assetCap!=null ? Math.min(ceiling,v.assetCap):ceiling;
  const diff=siteCost!=null && depot>0 ? siteCost-depot:null;
  const annualGap=room!=null && room<0 ? -room:0;
  const yearOne=siteCost==null || price==null?null:capital+interruption+fixed+capital*tax+utility+labor-retained+(c.terms==="purchase"?price*(1+closing):12*price);
  const early=(date:string) => {
    if(!date || !c.depotDate || sessions==null || v.shortfall==null) return null;
    const daysBefore=Math.max(0,(Date.parse(c.depotDate)-Date.parse(date))/86400000);
    return Math.floor(daysBefore*Math.min(sessions/365,v.shortfall));
  };
  const earlyMin=early(c.openLate),earlyMax=early(c.openEarly);
  let decision:Decision="Evidence needed", next="";
  if(c.rights==="unavailable"){
    decision=c.allOptionsReviewed && c.rightsSource.trim()?"Recommend closing":"Verify a condition";next="Check an alternative controlled footprint or document why every layout is unavailable.";
  }else if(c.rights!=="controlled" || !c.rightsSource.trim()){
    next="Obtain the measured layout and written rights to the stalls, aisle and hours.";decision="Verify a condition";
  }else if(missing.length){next="Confirm "+missing[0]+".";}
  else if(!sessions){next="Verify the service, operating window and fleet demand needed to complete a charge.";}
  else if(price==null){next=c.terms==="purchase"?"Confirm the assets and asking price.":"Obtain the monthly rent and lease term.";}
  else if(diff!=null && diff>1e-8){
    decision=room!=null && room>=0?"Reprice":"Verify a condition";
    next=annualGap>0?"Close the annual gap of "+amounts(annualGap)+" even at zero property cost.":"Test "+amounts(ceiling)+(c.terms==="lease"?" per month":"")+" with the owner.";
  }else if(c.comparator==="workbook" || !c.evidence.depot?.source || c.evidence.depot.status==="assumed"){
    decision="Verify a condition";next="Obtain the local depot comparison on the same energy and session basis.";
  }else if(!earlyMin || !peakSessions){decision="Verify a condition";next="Verify staffed peak demand and both opening windows to establish earlier charging slots.";}
  else {
    const crucial:Key[]=["stalls","supply","load","demand","cash","build","upgrade",...(hostAnnual?["hostFee","hostWeek","hostEnd"] as Key[]:[])];
    const first=crucial.find(key=> !c.evidence[key]?.source || c.evidence[key]?.status==="assumed");
    decision=first?"Verify a condition":"Advance diligence";next=first?"Obtain site evidence for "+fields[first].label+".":"Verify the proposed terms and closing conditions.";
  }
  const hostLimit=room!=null && price!=null && hostAnnual>0 && v.hostFee!=null ? v.hostFee+(room-price*factor)/hostAnnual:null;
  return {siteCost,depot:v.depot,difference:diff,perKwh:siteCost!=null && delivered>0?siteCost/delivered:null,sessions,peakSessions,earlyMin,earlyMax,ceiling,offer,
    yearOne,annualGap,hostLimit,decision,next,missing,uncovered:Math.max(0,(week-coveredWeek)*5+(end-coveredEnd)*2),opening:[c.openEarly,c.openLate].filter(Boolean).join(" – ")};
}
export type Result=ReturnType<typeof calculate>;
export type SavedCase={id:string;revision:number;name:string;author:string;at:string;model:string;sourceRevision:string;inputs:Inputs;result:Result;selected:boolean};
