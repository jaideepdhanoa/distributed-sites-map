"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { isStatementMeasure } from "@/lib/pnl/citation";
import { evidenceMeasures } from "@/lib/actions/comparisonEvidence";
import { reviewValue, evidenceChanged, figureKey, figureLabel, type CitationReview, type CitedFigure, type DecisionAccess, type FigureOption } from "@/lib/comparisonDecision";

type Props = {
  openStatement: (figure:CitedFigure) => void;
  view: string; sites: { id: string; title: string }[]; figures: FigureOption[];
  revision: number;
  checkGap: (figure: FigureOption) => void;
  inspect: (id: string, measure: string, source?: URLSearchParams) => void;
};
const statusNames: Record<string,string> = { open:"Awaiting approval", accepted:"Approved", ready:"Ready for approval", agreed_waiting:"Waiting", completed:"Completed", rejected:"Declined", superseded:"Superseded", resolved:"Resolved" };
export default function ComparisonDecision({view,sites,figures,inspect,checkGap,revision,openStatement}: Props) {
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
  const focusedKey = useSearchParams().get("reviewCitation");
  const focusRow = useRef<HTMLLIElement>(null);
  const selectedReview = access?.reviews?.find(item => item.key === focusedKey);
  const [editingReview,setEditingReview] = useState<CitationReview>();
  useEffect(() => {
    if (!focusedKey || editing || !focusRow.current) return;
    focusRow.current.focus({ preventScroll:true });
    focusRow.current.scrollIntoView({ block:"nearest" });
  }, [focusedKey, decision?.version, editing]);
  const byKey = new Map(figures.map(figure => [figureKey(figure), figure]));
  for (const c of decision?.citations || []) {
    const key = figureKey(c);
    if (!c.anchor || byKey.has(key)) continue;
    const review = access?.reviews?.find(r => r.key === key);
    if (review) byKey.set(key,{...c,...review.current,source:review.source,siteName:sites.find(s=>s.id===c.targetId)?.title || c.targetId});
  }
  const selectable = [...byKey.values()].filter(f => !isStatementMeasure(f.measure) || (f.anchor && f.value !== "—")).filter(figure => !["Unavailable", "Checking…", "Not applicable"].includes(figure.value));
  function edit(review?: CitationReview) {
    setEditingReview(review?.reason ? review : undefined);
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
    await submit({ decision: { preferred: choice === "hold" ? null : choice, rationale: reason.trim(), citations },
      ...(editingReview ? { review: { key:editingReview.key, token:editingReview.token } } : {}) });
  }
  async function submit(change: { decision?: unknown; keep?: boolean; review?: { key: string; token: string } }) {
    if (pending) return;
    const body = JSON.stringify({ view, version:decision?.version || "", ...change });
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
      if (change.keep && !confirmed.reviews?.find(item => item.key === change.review?.key)?.reviewedAt) throw Error("Couldn’t confirm the review. Retry.");
      setAccess(confirmed); setEditing(false); setEditingReview(undefined);
      window.dispatchEvent(new Event("queue-refresh"));
    } catch(e) { setError(e instanceof Error ? e.message : "Couldn’t confirm the decision."); }
    finally { setPending(false); }
  }
  if (!access) return error ? <p role="alert">{error} <button className="text-link" onClick={()=>setAttempt(n=>n+1)}>Retry decision</button></p> : <small role="status">Loading decision…</small>;
  if (!decision && !editing) return access.editable ? <button className="paper-btn" onClick={() => edit()}>Record decision</button> : <small>No decision recorded</small>;
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
      <header className="decision-summary">
        {focusedKey && <Link href="/?loops=work&workFilter=decisions" prefetch={false} className="text-link">Back to My work</Link>}
        <small>Diligence decision · {decision.author} · {new Date(decision.at).toLocaleDateString()}</small>
      <h3>{decision.preferred ? "Prefer " + (sites.find(s=>s.id===decision.preferred)?.title || decision.preferred) : "Hold all sites"}</h3>
      <p>{decision.rationale}</p>
      {decision.reviewedChange && <small>Reviewed {sites.find(site => site.id === decision.reviewedChange?.site)?.title || decision.reviewedChange.site} · {decision.reviewedChange.measure}</small>}
      </header>
      <ul>{decision.citations.map(c=>{
        const live=byKey.get(figureKey(c));
        const followUp = c.followUp;
        const label=evidenceMeasures[c.measure];
        const review = access.reviews?.find(item => item.key === figureKey(c));
        const current = review?.current || live;
        const changed = current && evidenceChanged(c, current);
        const focused = focusedKey === figureKey(c);
        return <li key={figureKey(c)} data-focused-citation={focused} tabIndex={focused ? -1 : undefined} ref={focused ? focusRow : undefined}><strong>{sites.find(s=>s.id===c.targetId)?.title || c.targetId} · {label}</strong>
          {changed ? <><small className="decision-change">Changed since decision</small><span>{reviewValue(c)} → {reviewValue(current)}</span></> : <span>{live ? reviewValue(c) : "Current figure unavailable · At decision · " + reviewValue(c)}</span>}
          {review?.reviewedAt && <small>Kept by {review.reviewedBy} · {new Date(review.reviewedAt).toLocaleString()}</small>}
          {review?.reason && (review.reviewedAt || review.reason.includes("completed")) && <span>{review.reason}{review.reviewedAt && " · Last reviewed " + reviewValue(review.previous)}</span>}
          {(c.source || review?.source) && <small>Source · {c.source || review?.source}</small>}
          <button className="text-link" onClick={()=>isStatementMeasure(c.measure) ? openStatement(c) : inspect(c.targetId,label)}>Inspect {isStatementMeasure(c.measure) ? label.replace("Statement ","statement ") : label.toLowerCase()}</button>
          {!followUp && live?.value === "—" && <button className="text-link" onClick={() => checkGap(live)}>Check missing evidence</button>}
          {followUp && <button className="text-link" onClick={()=>inspect(c.targetId,label,new URLSearchParams({panel:"discussion",note:followUp.note,site:followUp.targetId || c.targetId}))}>Follow-up · {statusNames[followUp.status] || followUp.status}{followUp.owner && " · Owner "+followUp.owner}{followUp.due && " · Due "+followUp.due}</button>}
          {review?.reason && access.editable && <div className="review-actions">
            <button type="button" className="paper-btn" disabled={pending} onClick={() => submit({ keep:true, review:{ key:review.key, token:review.token } })}>Keep decision</button>
            {focused && <button type="button" className="text-link" onClick={() => edit(review)}>Revise decision</button>}
          </div>}
        </li>;
      })}</ul>
      {access.editable && !selectedReview?.reason && <button className="text-link" onClick={() => edit(access.reviews?.find(item => item.reason))}>Revise decision</button>}
      {error && <p role="alert">{error} <button className="text-link" onClick={() => setAttempt(n => n + 1)}>Refresh decision</button></p>}
    </>}
  </section>;
}
