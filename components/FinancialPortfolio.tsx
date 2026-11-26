"use client";
import { useState } from "react";
import type { DealProps } from "@/lib/types";
import { amount, financialEvidence } from "@/lib/purchaseReview";

export function carryState(d:DealProps) {
  const w=d.purchase?.inputs;
  if (w?.cash==null || w.charge==null) return "Not calculated";
  return w.cash>=w.charge ? "Covers capital charge" : "Shortfall at ask";
}
export function FinanceFilters({deals,evidence,carry,setEvidence,setCarry}:{deals:DealProps[];evidence:string;carry:string;setEvidence:(s:string)=>void;setCarry:(s:string)=>void}) {
  return <div className="finance-filters"><label>Evidence<select className="secondary" value={evidence} onChange={e=>setEvidence(e.target.value)}>
    <option value="">All evidence</option>{[...new Set([...deals.map(financialEvidence),evidence].filter(Boolean))].sort().map(v=><option key={v}>{v}</option>)}
  </select></label><label>Workbook case<select className="secondary" value={carry} onChange={e=>setCarry(e.target.value)}>
    <option value="">All outcomes</option>{["Not calculated","Covers capital charge","Shortfall at ask"].map(v=><option key={v}>{v}</option>)}
  </select></label></div>;
}
export function financeMatch(d:DealProps,evidence:string,carry:string) {
  return (!evidence || financialEvidence(d)===evidence) && (!carry || carryState(d)===carry);
}
export default function FinancialPortfolio({deals,open}:{deals:DealProps[];open:(id:string)=>void}) {
  const [evidence,setEvidence]=useState(""),[carry,setCarry]=useState(""),[sort,setSort]=useState("evidence");
  const rows=deals.filter(d=>financeMatch(d,evidence,carry)).sort((a,b)=>sort==="evidence" ? financialEvidence(a).localeCompare(financialEvidence(b)) || a.deal_id.localeCompare(b.deal_id) :
    (b.purchase?.inputs.cash ?? -Infinity)-(a.purchase?.inputs.cash ?? -Infinity) || a.deal_id.localeCompare(b.deal_id));
  return <section className="financial-portfolio" aria-label="Financials in map area"><h3>Financials in map area</h3>
    <p>{deals.filter(d=>d.purchase?.inputs.cash!=null).length} of {deals.length} operating sites have a workbook cash calculation.</p>
    <FinanceFilters deals={deals} evidence={evidence} carry={carry} setEvidence={setEvidence} setCarry={setCarry}/>
    <label>Sort by <select className="secondary" value={sort} onChange={e=>setSort(e.target.value)}><option value="evidence">Evidence type</option><option value="cash">Workbook cash, high to low</option></select></label>
    <p role="status">{rows.length} matching sites</p><ul>{rows.map(d=><li key={d.deal_id}><button className="text-link" type="button" onClick={()=>open(d.deal_id)}>{d.name || d.address || d.deal_id}</button>
      <small>{financialEvidence(d)}{d.purchase?.inputs.cash!=null && " · "+amount(d.purchase.inputs.cash)+"/yr modeled"}</small></li>)}</ul></section>;
}
