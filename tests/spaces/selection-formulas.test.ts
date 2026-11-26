import assert from "node:assert/strict";
import test from "node:test";
import { reviewFields, planSelectionFormulas, formulaRequests } from "../../lib/selection/formulas";
import { parseResearch } from "../../lib/selection/research";
import type { SheetTable } from "../../lib/changes/mirror";

const derived = [11,16,17,18,19,20,21,22,23,24,25,26,64,65,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82];
const indices = [...derived,0,3,4,36,43,56,58,84,87,88];
const headers:string[]=[];
indices.forEach((col,i)=>headers[col]=reviewFields[i][0]);
function input(row:number,id:string) {
  const cells:string[]=[],formulas:string[]=[];
  cells[88]=id; cells[3]="Auto repair"; cells[4]="1 Desk screen";
  return {row,cells,formulas};
}
const source=input(5,"PIPE-PHX-9991");
derived.forEach(i=>source.formulas[i]="=1");
source.formulas[64]='=IF($A5="","",IF(COLUMN($BG$1),IF(INDIRECT("BE"&ROW())=Assumptions!$A$152,1,0),0))';
test("fills derived cells from the template, preserves existing values and excludes the quarantined row",()=>{
  const missing=input(18,"PIPE-PHX-9992");
  missing.cells[11]="0";
  const other=input(19,"PIPE-PHX-9993"); other.cells[81]="Manual section";
  const table:SheetTable={title:"Pipeline",headerRow:4,headers,rows:[source,input(10,"PIPE-PHX-9994"),missing,other]};
  const edits=planSelectionFormulas(table);
  assert.equal(edits.filter(e=>e.row===18).length,derived.length-1);
  assert.ok(edits.every(e=>e.row!==10 && e.row!==19 && e.column!==66));
  assert.match(edits.find(e=>e.row===18 && e.column===64)!.formula!,/INDIRECT\("BG"&ROW\(\)\)/);
  assert.match(edits.find(e=>e.column===81)!.formula!,/5 Evidence pending/);
  assert.equal(formulaRequests(edits,45).length,edits.length);
  assert.throws(()=>planSelectionFormulas({...table,headers:[]}));
});
test("research rejects unsafe links and impossible duplicate stall cases",()=>{
  const item={priority:"Hold",check:"Check aisle",scope:"Unpriced",note:"No plan",quote:null,basis:"Unknown",source:null,cases:[]};
  const parse=(r:object)=>parseResearch({version:1,reviewedOn:"2026-01-01",sites:{"PIPE-MIA-9999":r}});
  assert.ok(parse(item).has("PIPE-MIA-9999"));
  assert.throws(()=>parse({...item,source:"javascript:alert(1)"}));
  const c={stalls:4,base:0,stress:-0.1};
  assert.throws(()=>parse({...item,quote:1,cases:[c,c]}));
});
