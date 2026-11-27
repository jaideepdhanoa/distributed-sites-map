"use client";

import { useEffect, useRef, type FormEvent } from "react";
import type { PurchaseAssumptions } from "@/lib/purchaseReview";
import { defaultListAssumptions, type ListAssumptions } from "@/lib/charging/preliminary";
import { amounts } from "@/lib/charging/model";
import type { listScreen } from "@/lib/charging/listScreen";
import {listTrialHash} from "@/lib/charging/listTrial";
import {explanationUrl} from "@/lib/charging/evidence";
import { ChargingLink } from "./ChargingLink";

export function PipelineChargingDialog({onClose, assumptions, workbook, apply, site}:{
  onClose:()=>void; assumptions:ListAssumptions; workbook?:PurchaseAssumptions;
  apply:(next:ListAssumptions)=>void;
  site?:{id:string; name:string; screen:ReturnType<typeof listScreen>; revision?:string|null; next?:string};
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current!; d.showModal(); return () => d.close(); }, []);
  const c = workbook?.charging;
  const annual = workbook?.horizon && workbook?.demand && c?.charges ? c.charges / workbook.horizon / workbook.demand : null;
  const optional = (n?:number|null) => n == null ? "Workbook value" : String(n);
  function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const read = (key:string) => data.get(key) ? Number(data.get(key)) : undefined;
    apply({stalls:Number(data.get("stalls")), volume:Number(data.get("volume")), creditCash:data.has("creditCash"),
      upgrade:read("upgrade"), unitBuild:read("unitBuild"), attendant:read("attendant")});
  }
  return <dialog ref={ref} className="pipeline-cost-dialog" aria-labelledby="pipeline-cost-title" onCancel={onClose}>
    <div className="popover-head"><h2 id="pipeline-cost-title">{site ? site.name : "Cost assumptions"}</h2>
      <button type="button" className="close" aria-label="Close cost assumptions" onClick={onClose}>×</button></div>
    {site ? <>
      {site.screen.estimate && "layouts" in site.screen.estimate && <section className="preliminary-cost" aria-label="Preliminary site cost">
        <h3>{site.screen.group==="scenario"?"What if this footprint fits?":"Preliminary site cost per completed charge"}</h3>
        <p><b>{site.screen.cost.value}</b> per completed charge</p><p>{site.screen.cost.basis}</p>
        <p>{amounts(site.screen.estimate.layouts[0].base.annualCost)} annual net cost ÷ {Math.round(site.screen.estimate.layouts[0].base.sessions).toLocaleString("en-US")} annual charges</p>
        <a className="text-link" href={explanationUrl(site.id,undefined,window.location.pathname+window.location.search)+"&basis=list"+listTrialHash(assumptions)}>Open unit economics ledger</a>
      </section>}
      {!site.screen.estimate && <p>{site.screen.cost.value} · {site.screen.cost.basis}</p>}
      {site.screen.proxy != null && <p>Workbook depot proxy · {amounts(site.screen.proxy,2)} per charge, excluding electricity.</p>}
      {site.next && <p><b>Next check</b> · {site.next}</p>}
      <ChargingLink site={site.id} revision={site.revision} basis="detail">Open detailed site case</ChargingLink>
    </> : <form onSubmit={submit}>
      <p>Compare annual net cost divided by completed charges. Changes apply to list estimates and hypothetical layouts for this session. Selected case figures use their saved inputs.</p>
      <div className="pipeline-assumption-fields">
        <label>Spaces for unverified layouts<input className="field" name="stalls" type="number" min="1" max="200" step="1" required defaultValue={assumptions.stalls}/></label>
        <label>Completed charges (% of workbook)<input className="field" name="volume" type="number" min="1" max="200" step="any" required defaultValue={assumptions.volume}/></label>
        <label>Utility upgrade ($)<input className="field" name="upgrade" type="number" min="0" max="1000000000" step="any" placeholder={optional(c?.upgrade)} defaultValue={assumptions.upgrade}/></label>
        <label>Construction per stall ($)<input className="field" name="unitBuild" type="number" min="0" max="1000000000" step="any" placeholder={optional(c?.unitBuild)} defaultValue={assumptions.unitBuild}/></label>
        <label>Annual staffing per 24-hour post ($)<input className="field" name="attendant" type="number" min="0" max="1000000000" step="any" placeholder={optional(c?.attendant)} defaultValue={assumptions.attendant}/></label>
      </div>
      <label className="pipeline-cash-option"><input className="check" type="checkbox" name="creditCash" defaultChecked={assumptions.creditCash}/>Credit retained annual business income where supported</label>
      <p>{annual != null && <>Workbook volume is {Math.round(annual).toLocaleString("en-US")} charges per stall per year. </>}The downside uses 25% fewer charges and a 50% larger utility upgrade. Electricity, demand charges, special conversion works and shared overhead are excluded.</p>
      <div className="pipeline-dialog-actions"><button className="primary" type="submit">Apply to list</button><button type="button" className="text-link" onClick={()=>apply(defaultListAssumptions)}>Restore defaults</button></div>
    </form>}
  </dialog>;
}
