import { readGrids,writeFormulaBatch } from "./power-sheet-read";
import { SPREADSHEET_ID,PROTECTED_ROW,PROTECTED_SITE_ID,type SheetTable } from "../lib/changes/mirror";
import { readSheetRanges } from "../lib/changes/sheetTable";
import { activeCases } from "../lib/charging/store";
import { withConnectionString } from "../lib/actions/db";

const tab="Charging cases";
const headers=["Site ID","Selected case","Revision","Decision when saved","Site cost per charge","Depot cost per charge","Peak charges per shift","Earlier charges (conservative)","Parity ceiling","Terms","Model version","Evidence revision","Next check when saved"];
type Value=string|number;
export function chargingMirrorRows(table:SheetTable,saved:Awaited<ReturnType<typeof activeCases>>):Value[][] {
  const bySite=new Map(saved.map(r=>[r.site_id,r]));
  return [headers,...table.rows.flatMap(row=>{
    const id=row.cells[88];
    if(row.row===PROTECTED_ROW || id===PROTECTED_SITE_ID || !/^PIPE-(PHX|LAS|MIA)-\d{4}$/.test(id||"") ||
      !/^[12] (Desk|Financial) screen$/i.test(row.cells[4]||"") || /^land only/i.test(row.cells[10]||"") || /^land only/i.test(row.cells[84]||""))return [];
    const c=bySite.get(id);
    if(!c)return [[id,"","","No selected site case","","","","","","","","","Open the site case to review evidence."]];
    const r=c.result;
    return [[id,c.name,c.revision,r.decision,r.siteCost??"",r.depot??"",r.peakSessions??"",r.earlyMin??"",r.ceiling??"",c.inputs.terms,c.model,c.sourceRevision,r.next]];
  })];
}
export async function mirrorCharging(token:string,url:string,table:SheetTable,dryRun:boolean) {
  let cases:Awaited<ReturnType<typeof activeCases>>;
  try{cases=await withConnectionString(url,activeCases);}
  catch(error){if((error as {code?:string}).code==="42P01"){console.log("Charging mirror pending the approved scenario table.");return;}throw error;}
  const rows=chargingMirrorRows(table,cases);
  const grid=(await readGrids(token)).find(g=>g.title===tab);
  const read=async()=>(await readSheetRanges(token,SPREADSHEET_ID,["'Charging cases'!A:M"],"unformatted"))[0]??[];
  const previous=grid?await read():[];
  const normalize=(a:Value[][])=>a.map(r=>r.map(String).join("\t").replace(/\t+$/,"")).join("\n");
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
    rows:rows.map(row=>({values:row.map(v=>({userEnteredValue:typeof v==="number"?{numberValue:v}:{stringValue:v}}))})),fields:"userEnteredValue"}});
  await writeFormulaBatch(token,requests);
  if(normalize(await read())!==normalize(rows))throw Error("Charging case mirror readback mismatch.");
}
