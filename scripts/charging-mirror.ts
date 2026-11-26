import { readGrids,writeFormulaBatch } from "./power-sheet-read";
import { SPREADSHEET_ID,PROTECTED_ROW,PROTECTED_SITE_ID,type SheetTable } from "../lib/changes/mirror";
import { readSheetRanges } from "../lib/changes/sheetTable";
import { activeCases } from "../lib/charging/store";
import { type DealProps } from "../lib/types";
import { type ChargingSummary,summarize } from "../lib/charging/summary";
import { sourceRevision } from "../lib/charging/source";
import { unmappedChargingSite } from "../lib/charging/unmapped";
import { primeSnapshot } from "../lib/snapshot/read";
import { loadMapDeals } from "../lib/api/handlers/data/deals";
import { withConnectionString } from "../lib/actions/db";

const tab="Charging cases";
const headers=["Site ID","Selected case","Revision","Decision when saved","Site cost per charge","Depot cost per charge","Peak charges per shift","Earlier charges (conservative)","Parity ceiling","Terms","Model version","Evidence revision","Next check when saved","Scoring basis","Gap eligible for economics points","Conditional filed downside gap per charge","Hypothetical stalls at or below recorded fit"];
type Value=string|number;
export function chargingMirrorRows(table:SheetTable,saved:Awaited<ReturnType<typeof activeCases>>,current:Map<string,ChargingSummary>):Value[][] {
  const bySite=new Map(saved.map(r=>[r.site_id,r]));
  return [headers,...table.rows.flatMap(row=>{
    const id=row.cells[88];
    if(row.row===PROTECTED_ROW || id===PROTECTED_SITE_ID || !/^PIPE-(PHX|LAS|MIA)-\d{4}$/.test(id||"") ||
      !/^[12] (Desk|Financial) screen$/i.test(row.cells[4]||"") || /^land only/i.test(row.cells[10]||"") || /^land only/i.test(row.cells[84]||"") || row.cells[80]==="Land only")return [];
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
  })];
}
export async function mirrorCharging(token:string,url:string,table:SheetTable,dryRun:boolean) {
  let cases:Awaited<ReturnType<typeof activeCases>>;
  try{cases=await withConnectionString(url,activeCases);}
  catch(error){if((error as {code?:string}).code==="42P01"){console.log("Charging mirror pending the approved scenario table.");return;}throw error;}
  await primeSnapshot();
  const mapped=await loadMapDeals("reviewer");
  const current=new Map<string,ChargingSummary>();
  for(const f of mapped.features){
    const d=f.properties as DealProps;if(d.charging)current.set(d.deal_id,d.charging);
  }
  const selected=new Map(cases.map(c=>[c.site_id,c]));
  for(const row of table.rows){
    const id=row.cells[88];
    if(!id || current.has(id) || id===PROTECTED_SITE_ID || row.row===PROTECTED_ROW)continue;
    const d=unmappedChargingSite(id,row.cells[4]);
    if(d)current.set(id,summarize(d,sourceRevision(d),selected.get(id)));
  }
  const rows=chargingMirrorRows(table,cases,current);
  const grid=(await readGrids(token)).find(g=>g.title===tab);
  const read=async()=>(await readSheetRanges(token,SPREADSHEET_ID,["'Charging cases'!A:Q"],"unformatted"))[0]??[];
  const previous=grid?await read():[];
  // Sheets may round the last digits of calculated numbers on readback.
  const numeric=new Set([2,4,5,6,7,8,14,15,16]);
  const normalize=(a:Value[][])=>a.map((row,i)=>row.map((v,col)=>i>0 && numeric.has(col) && v!=="" && Number.isFinite(Number(v))?Number(v).toPrecision(12):String(v)).join("\t").replace(/\t+$/,"")).join("\n");
  if(grid && previous.length && normalize(previous.slice(0,1))!==normalize([headers]))throw Error("Charging mirror headers changed.");
  if(normalize(previous)===normalize(rows))return;
  console.log(JSON.stringify({event:"charging_mirror",records:rows.length-1,selected:cases.length,dryRun}));
  if(dryRun)return;
  if(!grid)await writeFormulaBatch(token,[{addSheet:{properties:{title:tab,gridProperties:{frozenRowCount:1}}}}]);
  const created=grid??(await readGrids(token)).find(g=>g.title===tab);
  if(!created)throw Error("Charging worksheet unavailable.");
  const endRowIndex=Math.max(previous.length,rows.length);
  const requests:object[]=[];
  if(endRowIndex>created.rowCount)requests.push({appendDimension:{sheetId:created.sheetId,dimension:"ROWS",length:endRowIndex-created.rowCount}});
  requests.push({updateCells:{range:{sheetId:created.sheetId,startRowIndex:0,endRowIndex,startColumnIndex:0,endColumnIndex:headers.length},
    rows:rows.map(row=>({values:row.map(v=>v===""?{}:{userEnteredValue:typeof v==="number"?{numberValue:v}:{stringValue:v}})})),fields:"userEnteredValue"}});
  await writeFormulaBatch(token,requests);
  if(normalize(await read())!==normalize(rows))throw Error("Charging case mirror readback mismatch.");
}
