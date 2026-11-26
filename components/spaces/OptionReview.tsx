import { useEffect, useRef, useState } from "react";
import { canWrite, useActionStatus } from "@/components/actions/panel";
import type { Note } from "@/lib/actions/notes";
import { fitOutcome, readReview, reviewBody, type Disposition, type Review } from "@/lib/spaces/optionReview";
import { usableOutline, type Assessment, type Option, type Point } from "@/lib/spaces/options";
import ScenarioInputs, { describeInputs, emptyInputs } from "./ScenarioInputs";

export function useOptionReviews(id: string) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    fetch("/api/actions/notes?" + new URLSearchParams({ targetKind: "deal", targetId: id }), { signal: controller.signal, cache: "no-store" })
      .then(async response => { if (!response.ok) throw Error(); return response.json(); })
      .then(data => { if (!controller.signal.aborted) { setNotes(data.notes || []); setState("ready"); } })
      .catch(() => { if (!controller.signal.aborted) setState("unavailable"); });
    return () => controller.abort();
  }, [id, attempt]);
  return { reviews: notes.map(note => ({ note, review: readReview(note) })).filter(x => x.review !== null)
    .sort((a,b) => Date.parse(b.note.createdAt) - Date.parse(a.note.createdAt)), state, retry: () => setAttempt(n => n+1) };
}
export default function OptionReview({ site, option, area, row, prior, dimensions, predicted, ready, refresh, edit, stopEdit, points, clearPoints }: {
  site: string; option: Option; area: string; row: Assessment; prior?: { note: Note; review: Review | null };
  dimensions: [number, number] | null; predicted: readonly [number, number] | null; ready: boolean; refresh: () => void; edit?: () => void; stopEdit: () => void; points?: Point[]; clearPoints: () => void;
}) {
  const status = useActionStatus();
  const [inputs, setInputs] = useState(emptyInputs);
  const [mode, setMode] = useState<Disposition | null>(null);
  const [why, setWhy] = useState("");
  const [rights, setRights] = useState("Unconfirmed");
  const [hours, setHours] = useState("Unconfirmed");
  const [measuredStalls, setMeasuredStalls] = useState("");
  const [measurementSource, setMeasurementSource] = useState("");
  const [pending,setPending] = useState(false);
  const [error,setError] = useState("");
  const receipt = useRef({ body: "", key: "" });
  const busy = useRef(false);
  const last = prior?.review;
  const currentFrame = row.image?.id || "unavailable";
  async function submit() {
    if (!mode || !ready || !why.trim() || busy.current) return;
    const geometry = points || (last?.frame === currentFrame ? last.points : undefined);
    if (geometry && !usableOutline(geometry)) { setError("The outline crosses itself or has no area. Adjust its corners before saving."); return; }
    const measured = measuredStalls.trim() !== "" ? { stalls: Number(measuredStalls), source: measurementSource.trim(), predicted: predicted ? [predicted[0], predicted[1]] as [number, number] : undefined } : undefined;
    if (measured && (!/^\d{1,4}$/.test(measuredStalls) || !measured.source)) { setError("Enter a whole stall count and identify its plan or site measurement."); return; }
    const body = reviewBody({ disposition: mode, option, area, revision: row.revision, frame: currentFrame,
      points: geometry, reason: why + " · Rights: " + rights + " · Operating availability: " + hours, assumptions: describeInputs(inputs), measured });
    if (body.length > 2000) { setError("Shorten the reason or measurement citation so this decision fits in a team note."); return; }
    if (receipt.current.body !== body) receipt.current = { body, key: crypto.randomUUID() };
    busy.current = true; setPending(true); setError("");
    try {
      const response = await fetch("/api/actions/notes", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": receipt.current.key },
        body: JSON.stringify({ targetKind: "deal", targetId: site, body }) });
      if (!response.ok) throw Error((await response.json()).error || "The review could not be saved.");
      const created = (await response.json()).note as Note;
      const verify = await fetch("/api/actions/notes?" + new URLSearchParams({ targetKind: "deal", targetId: site }), { cache: "no-store" });
      if (!verify.ok || !(await verify.json()).notes?.some((n: Note) => n.id === created.id && n.body === body)) throw Error("Save unconfirmed. Retry to check the same submission.");
      receipt.current = { body: "", key: "" };
      setMode(null); setWhy(""); setMeasuredStalls(""); setMeasurementSource(""); stopEdit(); clearPoints(); refresh();
      window.dispatchEvent(new Event("queue-refresh"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to confirm the review."); }
    finally { busy.current = false; setPending(false); }
  }
  return <>
    {last && prior && <div className="space-last-review"><strong>{last.disposition === "Keep for diligence" ? "Kept for diligence" : "Dismissed"} · {prior.note.authorId}</strong>
      <p>{last.reason}</p>{last.assumptions && <p>{last.assumptions}</p>}
      {last.measured && <p><strong>{last.measured.stalls} measured stalls · {fitOutcome(last.measured)}</strong><br/>{last.measured.source}</p>}
      <small>{prior.note.createdAt.slice(0,10)}{last.revision !== row.revision && " · Evidence has changed since this review"}</small></div>}
    <ScenarioInputs inputs={inputs} change={setInputs} dimensions={dimensions} />
    {ready && status.enabled && canWrite(status.actionRole) && <div className="space-decisions">
      {mode ? <form onSubmit={e => { e.preventDefault(); void submit(); }}>
        <strong>{mode}</strong>
        <div className="layout-inputs"><label>Rights to use area<select className="secondary" value={rights} onChange={e => setRights(e.target.value)}>{["Unconfirmed","Supported by evidence","Conditional or shared","Unavailable"].map(x => <option key={x}>{x}</option>)}</select></label>
        <label>Operating availability<select className="secondary" value={hours} onChange={e => setHours(e.target.value)}>{["Unconfirmed","All operating hours","Limited hours","Unavailable at peak"].map(x => <option key={x}>{x}</option>)}</select></label></div>
        <details className="disclosure"><summary className="disclosure">Record a dimensioned plan or site measurement</summary>
          <label>Measured stalls for this layout<input className="field" type="number" min="0" max="9999" step="1" value={measuredStalls} onChange={e=>setMeasuredStalls(e.target.value)} /></label>
          <label>Plan or measurement source<input className="field" maxLength={180} required={measuredStalls !== ""} value={measurementSource} onChange={e=>setMeasurementSource(e.target.value)} placeholder="Plan title and date, or field visit and measurement" /></label>
        </details>
        <label>Reason and supporting evidence<textarea className="field" required maxLength={450} value={why} onChange={e=>setWhy(e.target.value)} placeholder="Include the source, time window or next measurement." /></label>
        <div className="space-actions"><button className="primary" type="submit" disabled={pending || !why.trim()}>{pending ? "Saving…" : "Save team review"}</button><button className="text-link" type="button" disabled={pending} onClick={() => setMode(null)}>Cancel</button></div>
      </form> : <div className="space-actions">
        <button type="button" className="paper-btn" onClick={() => setMode("Keep for diligence")}>Keep for diligence</button>
        {edit && <button type="button" className="text-link" onClick={edit}>Adjust outline</button>}
        <button type="button" className="text-link" onClick={() => setMode("Dismiss option")}>Dismiss option</button>
      </div>}{error && <p role="alert">{error}</p>}
    </div>}
  </>;
}
