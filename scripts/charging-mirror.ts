import { readGrids,writeFormulaBatch } from "./power-sheet-read";
import { SPREADSHEET_ID,PROTECTED_ROW,PROTECTED_SITE_ID,type SheetTable } from "../lib/changes/mirror";
import { readSheetRanges } from "../lib/changes/sheetTable";
import { marketSequence,meritVersion } from "../lib/charging/merit";
import { activeCases } from "../lib/charging/store";
import { type ChargingSummary } from "../lib/charging/summary";
import { primeSnapshot } from "../lib/snapshot/read";
import { loadSelectionReview } from "../lib/api/handlers/data/selection-review";
import { withConnectionString } from "../lib/actions/db";

const tab="Charging cases";
const oldHeaders=["Site ID","Selected case","Revision","Decision when saved","Site cost per charge","Depot cost per charge","Peak charges per shift","Earlier charges (conservative)","Parity ceiling","Terms","Model version","Evidence revision","Next check when saved","Scoring basis","Gap eligible for economics points","Conditional filed downside gap per charge","Hypothetical stalls at or below recorded fit"];
const headers=[...oldHeaders,"Site action","Decision check","Downside gap per charge","Downside offer ceiling","Standalone downside value","Market sequence","Marginal downside value","Marginal peak charges","Decision version"];
type Value=string|number;
export function chargingMirrorRows(table:SheetTable,saved:Awaited<ReturnType<typeof activeCases>>,current:Map<string,ChargingSummary>,activeIds?:Set<string>):Value[][] {
  const bySite=new Map(saved.map(r=>[r.site_id,r]));
  const data:Value[][]=table.rows.flatMap(row=>{
    const id=row.cells[88];
    if(row.row===PROTECTED_ROW || id===PROTECTED_SITE_ID || !/^PIPE-(PHX|LAS|MIA)-\d{4}$/.test(id||"") ||
      (activeIds ? !activeIds.has(id) : !/^[12] (Desk|Financial) screen$/i.test(row.cells[4]||"")) || /^land only/i.test(row.cells[10]||"") || /^land only/i.test(row.cells[84]||"") || row.cells[80]==="Land only")return [];
    const c=bySite.get(id);
    const summary=current.get(id);
    const fit=Number(row.cells[43]);
    const ref=summary?.screen.filter(s=>s.stalls<=fit).sort((a,b)=>b.stalls-a.stalls)[0];
    const depot=summary?.screenDepot;
    const gap=ref && depot!=null?-ref.downside*depot:"";
    if(!c){
      return [[id,"","","No selected site case","",depot??"","","","","","","","Verify the measured footprint and local costs.",ref && depot!=null?"Paid Moove network downside at "+ref.stalls+" stalls":"Evidence needed","",gap,ref?.stalls??""]];
    }
    const r=c.result, fresh=summary?.selected===c.id+":"+c.revision && !summary.stale;
    return [[id,c.name,c.revision,r.decision,r.siteCost??"",r.depot??"",r.peakSessions??"",r.earlyMin??"",r.ceiling??"",c.inputs.terms,c.model,c.sourceRevision,r.next,
      !fresh?"Refresh evidence":c.inputs.comparator==="local"?"Selected local depot case":"Selected proxy case",
      fresh && c.inputs.rights==="controlled" && c.inputs.comparator==="local" && c.inputs.comparable && c.inputs.evidence.depot?.status!=="assumed" && c.inputs.evidence.depot?.date && r.difference!=null?r.difference:"",gap,ref?.stalls??""]];
  });
  const sequence=marketSequence([...current].map(([id,c])=>({id,city:id.split("-")[1],merit:c.merit})));
  return [headers,...data.map(row=>{
    const id=String(row[0]),m=current.get(id)?.merit,r=sequence.get(id);
    return [...row,m?.action??"Evidence needed",m?.next??"Reconcile current site and stage.",m?.downsideGap??"",m?.downsideCeiling??"",
      m?.netValue??"",r?.rank??"",r?.value??"",r?.peak??"",meritVersion];
  })];
}
const scorecardNote="Historical workbook points are shown below. For site actions, downside economics and the investment sequence by market, see Charging cases. Current site cases use a comparable local depot at parity.";
async function updateScorecardNote(token:string,sheetId:number,dryRun:boolean) {
  const read=async()=>(await readSheetRanges(token,SPREADSHEET_ID,["'Scorecard'!A3"],"unformatted"))[0]?.[0]?.[0];
  const existing=await read();
  if(existing===scorecardNote || dryRun)return;
  // Only replace the original explanatory caption. Preserve user-authored text.
  if(typeof existing!=="string" || !existing.startsWith("Cost per charge compares with the hub's") || !existing.includes("30% target"))return;
  await writeFormulaBatch(token,[{updateCells:{range:{sheetId,startRowIndex:2,endRowIndex:3,startColumnIndex:0,endColumnIndex:1},
    rows:[{values:[{userEnteredValue:{stringValue:scorecardNote}}]}],fields:"userEnteredValue"}}]);
  if(await read()!==scorecardNote)throw Error("Scorecard note readback mismatch.");
}
export async function mirrorCharging(token:string,url:string,table:SheetTable,dryRun:boolean) {
  let cases:Awaited<ReturnType<typeof activeCases>>;
  try{cases=await withConnectionString(url,activeCases);}
  catch(error){if((error as {code?:string}).code==="42P01"){console.log("Charging mirror pending the approved scenario table.");return;}throw error;}
  await primeSnapshot();
  const portfolio=await loadSelectionReview("reviewer");
  if(!portfolio.hasInputs || !portfolio.rows.length)throw Error("Current selection inputs unavailable. Preserve the previous charging mirror.");
  const current=new Map(portfolio.rows.flatMap(r=>r.charging?[[r.id,r.charging] as const]:[]));
  const ids=new Set(portfolio.rows.map(r=>r.id));
  const selected=new Map(cases.map(c=>[c.site_id,c]));
  for(const [id,c] of current){
    const selectedCase=selected.get(id);
    const key=selectedCase ? selectedCase.id+":"+selectedCase.revision : null;
    if(c.selected!==key)throw Error("Selection changed during mirror read. Retry with the current revisions.");
  }
  const rows=chargingMirrorRows(table,cases,current,ids);
  const grids=await readGrids(token);
  const grid=grids.find(g=>g.title===tab);
  const scorecard=grids.find(g=>g.title==="Scorecard");
  const read=async()=>(await readSheetRanges(token,SPREADSHEET_ID,["'Charging cases'!A:Z"],"unformatted"))[0]??[];
  const previous=grid?await read():[];
  // Sheets may round the last digits of calculated numbers on readback.
  const numeric=new Set([2,4,5,6,7,8,14,15,16,19,20,21,22,23,24]);
  const normalize=(a:Value[][])=>a.map((row,i)=>row.map((v,col)=>i>0 && numeric.has(col) && v!=="" && Number.isFinite(Number(v))?Number(v).toPrecision(12):String(v)).join("\t").replace(/\t+$/,"")).join("\n");
  if(grid && previous.length && normalize(previous.slice(0,1))!==normalize([headers]) && normalize(previous.slice(0,1))!==normalize([oldHeaders]))throw Error("Charging mirror headers changed.");
  if(normalize(previous)===normalize(rows)){
    if(scorecard)await updateScorecardNote(token,scorecard.sheetId,dryRun);
    return;
  }
  console.log(JSON.stringify({event:"charging_mirror",records:rows.length-1,selected:cases.length,dryRun}));
  if(dryRun)return;
  if(!grid)await writeFormulaBatch(token,[{addSheet:{properties:{title:tab,gridProperties:{frozenRowCount:1}}}}]);
  const created=grid??(await readGrids(token)).find(g=>g.title===tab);
  if(!created)throw Error("Charging worksheet unavailable.");
  const endRowIndex=Math.max(previous.length,rows.length);
  const requests:object[]=[];
  if(headers.length>created.columnCount)requests.push({appendDimension:{sheetId:created.sheetId,dimension:"COLUMNS",length:headers.length-created.columnCount}});
  if(endRowIndex>created.rowCount)requests.push({appendDimension:{sheetId:created.sheetId,dimension:"ROWS",length:endRowIndex-created.rowCount}});
  requests.push({updateCells:{range:{sheetId:created.sheetId,startRowIndex:0,endRowIndex,startColumnIndex:0,endColumnIndex:headers.length},
    rows:rows.map(row=>({values:row.map(v=>v===""?{}:{userEnteredValue:typeof v==="number"?{numberValue:v}:{stringValue:v}})})),fields:"userEnteredValue"}});
  await writeFormulaBatch(token,requests);
  if(normalize(await read())!==normalize(rows))throw Error("Charging case mirror readback mismatch.");
  if(scorecard)await updateScorecardNote(token,scorecard.sheetId,dryRun);
}
