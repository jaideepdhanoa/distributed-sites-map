"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { evidenceMeasures, type EvidenceTarget, type EvidenceRequest } from "@/lib/actions/comparisonEvidence";
import { canWrite, useActionStatus } from "./panel";

import { RecordActions } from "./RecordActions";

type Lookup = { followUp: EvidenceRequest | null; accounts: { id: string; name: string }[] };
const statuses: Record<string,string> = { open:"Awaiting approval", accepted:"Approved", ready:"Ready for approval", agreed_waiting:"Waiting", completed:"Completed", rejected:"Declined", superseded:"Superseded" };

export default function ComparisonEvidence({target, title, context = "Not on file", close, inspect, saved}: {
  target: EvidenceTarget; title: string; context?: string; close: () => void; inspect: (note:string) => void; saved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const access = useActionStatus();
  const [lookup,setLookup] = useState<Lookup>();
  const [showThread,setShowThread] = useState(false);
  const [attempt,setAttempt] = useState(0);
  const [readFailed,setReadFailed] = useState(false);
  const [pending,setPending] = useState(false);
  const [error,setError] = useState("");
  const label = evidenceMeasures[target.measure];
  const [description,setDescription] = useState("Confirm " + label.toLowerCase() + ".");
  const [owner,setOwner] = useState("");
  const [due,setDue] = useState("");
  const receipt = useRef({ draft:"", key:"" });
  const endpoint = "/api/actions/comparison-evidence?" + new URLSearchParams({targetId:target.targetId,targetKind:target.targetKind,measure:target.measure,period:target.period,basis:target.basis});
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setReadFailed(false);
    fetch(endpoint,{ signal:controller.signal,cache:"no-store" }).then(async response => {
      if (!response.ok) throw Error();
      const data:Lookup = await response.json();
      if (!controller.signal.aborted) setLookup(data);
    }).catch(() => { if (!controller.signal.aborted) setReadFailed(true); });
    return () => controller.abort();
  }, [endpoint, attempt]);
  async function submit(event:FormEvent) {
    event.preventDefault();
    if (pending || !lookup || lookup.followUp || !description.trim()) return;
    const draft = JSON.stringify({description,owner,due});
    if (draft !== receipt.current.draft) receipt.current = { draft, key:crypto.randomUUID() };
    setPending(true);
    setError("");
    try {
      const response = await fetch(endpoint,{method:"POST", headers:{"Content-Type":"application/json","Idempotency-Key":receipt.current.key}, body:draft});
      if (!response.ok) throw Error();
      const { followUp } = await response.json();
      if (!followUp?.note) throw Error();
      setLookup({...lookup,followUp});
      saved();
    } catch { setError("Couldn’t confirm the request. Your draft is here. Try again."); }
    finally { setPending(false); }
  }
  const item = lookup?.followUp;
  return <dialog ref={dialog} className="compare-evidence-sheet" aria-labelledby="compare-evidence-title"
    onCancel={event=>{event.preventDefault(); if (!pending) close();}}>
    <header><div><span className="eyebrow">{title}</span><h2 id="compare-evidence-title">{label}</h2></div>
      <button className="close" type="button" aria-label="Close evidence request" onClick={close} disabled={pending}>×</button></header>
    <p>{[target.period,target.basis,context].filter(Boolean).join(" · ")}</p>
    {readFailed ? <p role="alert">Couldn’t check for an existing request. <button type="button" className="text-link" onClick={()=>setAttempt(n=>n+1)}>Retry</button></p>
    : !lookup ? <p role="status">Checking for a follow-up…</p>
    : item ? <section aria-label="Existing follow-up">
      <p role="status">{statuses[item.status] || item.status} · {item.owner || "Unassigned"}{item.due && " · Due " + item.due}</p>
      {showThread ? <RecordActions kind={item.targetKind || target.targetKind} id={item.targetId || target.targetId} threadId={item.note} />
        : <button type="button" className="primary" onClick={()=>target.measure === "power" ? setShowThread(true) : inspect(item.note)}>View follow-up</button>}
    </section> : canWrite(access.actionRole) ? <form onSubmit={submit}>
      <label>Evidence needed<textarea className="field" required maxLength={500} value={description} disabled={pending} onChange={e=>setDescription(e.target.value)} /></label>
      <label>Owner<select className="secondary" value={owner} disabled={pending} onChange={e=>setOwner(e.target.value)}><option value="">Unassigned</option>
        {lookup.accounts.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
      <label>Due date<input type="date" className="field" value={due} disabled={pending} onChange={e=>setDue(e.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" className="primary" disabled={pending || !description.trim()}>{pending ? "Saving…" : "Request evidence"}</button>
    </form> : <p>No open follow-up for this measure.</p>}
  </dialog>;
}
