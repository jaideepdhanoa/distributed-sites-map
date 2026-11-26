import { PROTECTED_ROW, PROTECTED_SITE_ID, type SheetTable } from "../changes/mirror";

// These are derived columns. Header checks prevent a copy into input or note fields.
const derived:Record<number,string> = {
  "11": "Stalls on site (from Stalls that fit)",
  "16": "Price ÷ EBITDA",
  "17": "Cash from the business ($ a year)",
  "18": "Financing cost at asking price ($ a year)",
  "19": "Network of sites like this, free land ($, 10 years)",
  "20": "Land cost a site can carry at the target ($ a year)",
  "21": "Saving vs. hub at asking price",
  "22": "Most Moove can pay ($)",
  "23": "EBITDA needed at asking price ($ a year)",
  "24": "Walk-away price ($)",
  "25": "Saving vs. temporary charging at asking price ($ a month)",
  "26": "Months of temporary charging needed to meet the target",
  "64": "Confidence (%)",
  "65": "Confidence",
  "67": "Screening price ($)",
  "68": "Saving vs. hub at the screening price",
  "69": "Cost per charge at the screening price ($)",
  "70": "Saving with the business's staff by day",
  "71": "Saving as land only",
  "72": "Best setup",
  "73": "Cost per charge in the best setup ($)",
  "74": "Economics points",
  "75": "Land points",
  "76": "Power points",
  "77": "Location points",
  "78": "Deal points",
  "79": "Score (of 100)",
  "80": "Knock-out",
  "81": "Scorecard section",
  "82": "Rank"
};
const guards:Record<number,string> = {0:"Site",3:"Segment",4:"Stage",10:"Archetype",36:"Real estate in the sale",43:"Stalls that fit",
  56:"Deal notes",58:"Financials status",84:"Business check",87:"Tenant lease blocks site",88:"Site ID"};
export const reviewFields = [...Object.values(derived), ...Object.values(guards)].map(header=>[header]);
type Edit = {row:number; column:number; id:string; formula?:string};
const legacy = 'INDIRECT("BE"&ROW())';
const corrected = 'INDIRECT("BG"&ROW())';
const documented = 'Assumptions!$A$152';
function confidence(formula:string) {
  return formula.includes(legacy) && formula.includes(documented) && formula.includes('COLUMN($BG$1)') ? formula.replace(legacy,corrected) : formula;
}
function parityPoints(r:number) {
  const gap=`INDEX('Charging cases'!$O:$O,MATCH($CK${r},'Charging cases'!$A:$A,0))`;
  return `=IFERROR(IF(OR($A${r}="",COUNT(${gap})=0),"",IF(${gap}<=0,Assumptions!$B$77,0)),"")`;
}
function pendingSection(r:number) {
  return `=IF($A${r}="","",IF(REGEXMATCH(LOWER(E${r}),"dropped"),"3 Dropped",IF(REGEXMATCH(LOWER(E${r}),"off[ -]?market"),"4 Off market",IF(OR(CC${r}<>"",CJ${r}="Yes"),"2 Knocked out",IF(AND(ISNUMBER(AR${r}),AR${r}>=Assumptions!$B$68,AK${r}="Yes",ISNUMBER(BQ${r}),CG${r}<>"",CG${r}<>"Not confirmed"),"1 Ranked","5 Evidence pending")))))`;
}
export function planSelectionFormulas(table:SheetTable):Edit[] {
  if(table.title!=="Pipeline" || table.headerRow!==4 || Object.entries({...guards,...derived}).some(([i,h])=>table.headers[Number(i)]!==h))
    throw Error("Selection formula headers changed; review the mapping.");
  const template=table.rows.find(r=>r.row===5);
  if (!template || Object.keys(derived).some(i=>!template.formulas?.[Number(i)]?.startsWith("=")))
    throw Error("Selection formula template is incomplete.");
  const edits:Edit[]=[];
  const seen=new Set<string>();
  for(const {row,cells,formulas=[]} of table.rows) {
    const id=cells[88];
    if(!id || row===PROTECTED_ROW || id===PROTECTED_SITE_ID || !/^PIPE-(PHX|LAS|MIA)-\d{4,}$/.test(id)) continue;
    if(seen.has(id)) throw Error("Duplicate selection formula target.");
    seen.add(id);
    if(!/^[12] (Desk|Financial) screen$/i.test(cells[4])) continue;
    if (/^land only/i.test(cells[10] || "") || /^land only/i.test(cells[84] || "") || cells[80]==="Land only") continue;
    // Update the active operating rows only. Historical targets retain their recorded basis.
    const allowance=formulas[20] || "";
    if(allowance.includes("(1-Assumptions!$B$22)*Assumptions!$B$26"))
      edits.push({row,column:20,id,formula:allowance.replace("(1-Assumptions!$B$22)*Assumptions!$B$26","Assumptions!$B$26")});
    const points=formulas[74] || "";
    if(points.includes("Assumptions!$B$83") && points.includes("Assumptions!$B$84"))
      edits.push({row,column:74,id,formula:parityPoints(row)});
    const old=formulas[64] || "";
    if(old && confidence(old)!==old) edits.push({row,column:64,id,formula:confidence(old)});
    if(!["Auto repair","Quick lube"].includes(cells[3]) || cells[81] || formulas[81]) continue;
    for(const key of Object.keys(derived)) {
      const column=Number(key);
      if(cells[column] || formulas[column]) continue;
      let formula:string|undefined;
      if(column===74 && template.formulas![74].includes("Assumptions!$B$77"))formula=parityPoints(row);
      else if(column===20 && template.formulas![20].includes("Assumptions!$B$26"))formula=template.formulas![20].replace("(1-Assumptions!$B$22)*Assumptions!$B$26","Assumptions!$B$26").replace(/([A-Z]+)5(?![0-9])/g,(_,col)=>col+row);
      else if(column===64) {
        // Substitute only the row-relative A1 references in this known template.
        const src=confidence(template.formulas![64]);
        if(!src.includes(corrected)) throw Error("Unrecognized confidence formula.");
        formula=src.replaceAll("$A5",`$A${row}`).replaceAll("BF5:BL5",`BF${row}:BL${row}`);
      }
      if(column===81) formula=pendingSection(row);
      edits.push({row,column,id,formula});
    }
  }
  return edits;
}
export function formulaRequests(edits:Edit[],sheetId:number) {
  const position=(row:number,c:number)=>({sheetId,startRowIndex:row-1,endRowIndex:row,startColumnIndex:c,endColumnIndex:c+1});
  return edits.map(({row,column,formula})=>formula
    ? {updateCells:{range:position(row,column),rows:[{values:[{userEnteredValue:{formulaValue:formula}}]}],fields:"userEnteredValue"}}
    : {copyPaste:{source:position(5,column),destination:position(row,column),pasteType:"PASTE_FORMULA"}});
}
export function checkSelectionFormulas(table:SheetTable,edits:Edit[]) {
  const rows=new Map(table.rows.map(r=>[r.row,r]));
  for(const edit of edits) {
    const row=rows.get(edit.row), actual=row?.formulas?.[edit.column];
    if(row?.cells[88]!==edit.id || !actual?.startsWith("=") || (edit.formula && actual!==edit.formula) ||
      /^#(REF!|DIV\/0!|VALUE!|ERROR!|N\/A|NAME\?|NUM!)/.test(row.cells[edit.column] || ""))
      throw Error("Selection formula readback did not match.");
  }
}
