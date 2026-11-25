"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { evidenceMeasures } from "@/lib/actions/comparisonEvidence";
import { figureKey, figureLabel, type CitedFigure, type DecisionAccess, type FigureOption } from "@/lib/comparisonDecision";

type Props = {
  view: string; sites: { id: string; title: string }[]; figures: FigureOption[];
  revision: number;
  checkGap: (figure: FigureOption) => void;
  inspect: (id: string, measure: string, source?: URLSearchParams) => void;
};
const statusNames: Record<string,string> = { open:"Awaiting approval", accepted:"Approved", ready:"Ready for approval", agreed_waiting:"Waiting", completed:"Completed", rejected:"Declined", superseded:"Superseded", resolved:"Resolved" };
function valueText(figure: CitedFigure) {
  return [figure.value === "—" ? "Not on file" : figure.value, figure.period, figure.basis].filter(Boolean).join(" · ");
}

export default function ComparisonDecision({view,sites,figures,inspect,checkGap,revision}: Props) {
  const [access,setAccess] = useState<DecisionAccess>();
  const [attempt,setAttempt] = useState(0);
  const [editing,setEditing] = useState(false);
  const [choice,setChoice] = useState("");
  const [reason,setReason] = useState("");
  const [keys,setKeys] = useState<string[]>([]);
  const [candidate,setCandidate] = useState("");
  const [error,setError] = useState("");
  const [pending,setPending] = useState(false);
  const receipt = useRef({body:"",key:""});
  const endpoint = "/api/actions/comparison-decision?view=" + encodeURIComponent(view);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    fetch(endpoint,{cache:"no-store",signal:controller.signal}).then(async r=>{
      if (!r.ok) throw Error();
      const data = await r.json();
      if (!controller.signal.aborted) setAccess(data);
    }).catch(()=>{if (!controller.signal.aborted) setError("Couldn’t load the decision.");});
    return ()=>controller.abort();
  },[endpoint,attempt,revision]);
  const decision = access?.decision;
  const byKey = new Map(figures.map(figure => [figureKey(figure), figure]));
  const selectable = figures.filter(figure => !["Unavailable", "Checking…", "Not applicable"].includes(figure.value));
  function edit() {
    setChoice(decision ? decision.preferred || "hold" : "");
    setReason(decision?.rationale || "");
    setKeys(decision?.citations.map(figureKey) || []);
    setCandidate(""); setEditing(true); setError("");
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending || !choice || !keys.length) return;
    const citations: CitedFigure[] = [];
    for (const key of keys) {
      const figure = byKey.get(key);
      if (!figure || !selectable.includes(figure)) continue;
      const { siteName, ...citation } = figure;
      citations.push(citation);
    }
    if (citations.length !== keys.length) { setError("A cited figure is unavailable. Review your citations."); return; }
    const body = JSON.stringify({view,version:decision?.version || "",decision:{ preferred:choice==="hold" ? null : choice, rationale:reason.trim(),citations }});
    if (receipt.current.body !== body) receipt.current={body,key:crypto.randomUUID()};
    setPending(true); setError("");
    try {
      const r=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":receipt.current.key},body});
      const data=await r.json();
      if (!r.ok) throw Error(data.error || "Couldn’t save decision.");
      const read=await fetch(endpoint,{cache:"no-store"});
      if (!read.ok) throw Error("Couldn’t confirm the save. Retry with your draft.");
      const confirmed:DecisionAccess=await read.json();
      if (!confirmed.decision || confirmed.decision.version !== data.decision?.version) throw Error("Couldn’t confirm the decision.");
      setAccess(confirmed); setEditing(false);
    } catch(e) { setError(e instanceof Error ? e.message : "Couldn’t confirm the decision."); }
    finally { setPending(false); }
  }
  if (!access) return error ? <p role="alert">{error} <button className="text-link" onClick={()=>setAttempt(n=>n+1)}>Retry decision</button></p> : <small role="status">Loading decision…</small>;
  if (!decision && !editing) return access.editable ? <button className="paper-btn" onClick={edit}>Record decision</button> : <small>No decision recorded</small>;
  return <section className="decision-brief" aria-label="Comparison decision">
    {editing ? <form onSubmit={save}>
      <label>Decision<select required className="secondary" value={choice} onChange={e=>setChoice(e.target.value)}>
        <option value="">Choose an outcome</option><option value="hold">Hold all sites</option>
        {sites.map(s=><option key={s.id} value={s.id}>Prefer {s.title}</option>)}</select></label>
      <label>Reason<textarea required className="field" maxLength={600} value={reason} onChange={e=>setReason(e.target.value)} /></label>
      <label>Cite a figure<select className="secondary" value={candidate} onChange={e=>setCandidate(e.target.value)}>
        <option value="">Choose a site and measure</option>{selectable.filter(f=>!keys.includes(figureKey(f))).map(f=><option key={figureKey(f)} value={figureKey(f)}>{figureLabel(f)}</option>)}</select></label>
      <button className="paper-btn" type="button" disabled={!candidate || keys.length>=6} onClick={()=>{setKeys([...keys,candidate]);setCandidate("");}}>Add citation</button>
      {keys.map(k=><div key={k}>{byKey.has(k) ? figureLabel(byKey.get(k)!) : k} <button type="button" className="text-link" onClick={()=>setKeys(keys.filter(item=>item!==k))}>Remove</button></div>)}
      {error && <p role="alert">{error} <button className="text-link" type="button" onClick={()=>{setEditing(false);setAccess(undefined);setAttempt(n=>n+1);}}>Refresh decision</button></p>}
      <div><button className="primary" disabled={pending || !choice || !reason.trim() || !keys.length}>{pending ? "Saving…" : "Save decision"}</button> <button className="text-link" type="button" disabled={pending} onClick={()=>setEditing(false)}>Cancel</button></div>
    </form> : decision && <>
      <header className="decision-summary"><small>Diligence decision · {decision.author} · {new Date(decision.at).toLocaleDateString()}</small>
      <h3>{decision.preferred ? "Prefer " + (sites.find(s=>s.id===decision.preferred)?.title || decision.preferred) : "Hold all sites"}</h3>
      <p>{decision.rationale}</p></header>
      <ul>{decision.citations.map(c=>{
        const live=byKey.get(figureKey(c));
        const followUp = c.followUp;
        const label=evidenceMeasures[c.measure];
        const changed=live && (c.value!==live.value || c.period!==live.period || c.basis!==live.basis);
        return <li key={figureKey(c)}><strong>{sites.find(s=>s.id===c.targetId)?.title || c.targetId} · {label}</strong>
          {changed ? <><small className="decision-change">Changed since decision</small><span>{valueText(c)} → {valueText(live)}</span></> : <span>{live ? valueText(c) : "Current figure unavailable · At decision · " + valueText(c)}</span>}
          <button className="text-link" onClick={()=>inspect(c.targetId,label)}>Inspect {label.toLowerCase()}</button>
          {!followUp && live?.value === "—" && <button className="text-link" onClick={() => checkGap(live)}>Check missing evidence</button>}
          {followUp && <button className="text-link" onClick={()=>inspect(c.targetId,label,new URLSearchParams({panel:"discussion",note:followUp.note}))}>Follow-up · {statusNames[followUp.status] || followUp.status}{followUp.owner && " · Owner "+followUp.owner}{followUp.due && " · Due "+followUp.due}</button>}
        </li>;
      })}</ul>
      {access.editable && <button className="text-link" onClick={edit}>Revise decision</button>}
    </>}
  </section>;
}
