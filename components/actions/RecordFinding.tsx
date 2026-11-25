"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { currentSearch, rememberSearch } from "@/lib/navSearch";
import { canWrite, useActionStatus } from "./panel";

type FindingSummary = { title: string; text: string };
type StoredNote = { body: string; createdAt: string; deleted: boolean };
type StoredProposal = { reason: string; status: string; proposedValue: string; createdAt: string };

function findingText(body: string) {
  const match = /^(Screening finding|Missing evidence)\n([\s\S]+?)\nCheck: /.exec(body);
  return match ? { title: match[1] === "Missing evidence" ? "Evidence gap saved" : "Finding saved", text: match[2] } : null;
}

type FindingProps = {
  kind: "site" | "deal";
  id: string;
  source: string;
  review: string;
};

export default function RecordFinding({ kind, id, source, review }: FindingProps) {
  const status = useActionStatus();
  const params = useSearchParams();
  const findingRequested = params.get("panel") === "finding";
  const [open, setOpen] = useState(findingRequested);
  const [outcome, setOutcome] = useState("finding");
  const [body, setBody] = useState("");
  const [citation, setCitation] = useState<string | null>(null);
  const [field, setField] = useState("zoning");
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<FindingSummary | null>(null);
  const [recent, setRecent] = useState<FindingSummary | null>(null);
  const submitting = useRef(false);
  const receipt = useRef({ draft: "", key: "" });
  const trigger = useRef<HTMLButtonElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const confirmed = useRef<HTMLDivElement>(null);
  const live = useRef(false);
  const proposal = outcome === "proposal";
  const reviewing = params.get("review") === "1" || params.get("view") === "review";
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => { if (findingRequested) setOpen(true); }, [findingRequested]);
  useEffect(() => { if (open && status.enabled) editor.current?.focus(); }, [open, status.enabled]);
  useEffect(() => { if (saved) confirmed.current?.focus({ preventScroll: true }); }, [saved]);
  useEffect(() => {
    if (!status.enabled) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ targetKind: kind, targetId: id });
    async function history() {
      const get = async (path: string) => {
        const response = await fetch(`/api/actions/${path}?${query}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) return [];
        const result = await response.json();
        return Array.isArray(result[path]) ? result[path] : [];
      };
      const [notes, proposals] = await Promise.all([get("notes"), get("suggestions")]);
      const items = (notes as StoredNote[]).flatMap(note => {
        const finding = !note.deleted && findingText(note.body);
        return finding ? [{ ...finding, at: note.createdAt }] : [];
      });
      for (const item of proposals as StoredProposal[]) {
        if (!findingText(item.reason)) continue;
        const title = item.status === "open" ? "Change submitted for approval" : `Proposed change · ${item.status}`;
        items.push({ title, text: item.proposedValue, at: item.createdAt });
      }
      items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
      if (!controller.signal.aborted) setRecent(items[0] || null);
    }
    void history().catch(() => undefined);
    return () => controller.abort();
  }, [status.enabled, kind, id]);

  const writable = status.enabled && canWrite(status.actionRole);
  const confirmation = saved || recent;
  if (!writable && !confirmation) return null;

  function closeEditor() {
    setOpen(false);
    if (!findingRequested) return;
    const query = new URLSearchParams(currentSearch());
    query.delete("panel");
    const href = `/?${query}`;
    rememberSearch(href);
    window.history.replaceState(null, "", href);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || !body.trim() || (proposal && !value.trim())) return;
    const sourceText = (citation ?? source).trim();
    const description = [outcome === "missing" ? "Missing evidence" : "Screening finding", body.trim(), `Check: ${review}`, sourceText && `Source: ${sourceText}`].filter(Boolean).join("\n");
    if (description.length > 2000) { setError("Shorten the finding or source to fit 2,000 characters."); return; }
    const target = { targetKind: kind, targetId: id };
    const payload = proposal ? { ...target, field: "correction", detail: field, proposedValue: value.trim(), reason: description }
      : { ...target, body: description };
    const draft = JSON.stringify(payload);
    if (receipt.current.draft !== draft) receipt.current = { draft, key: crypto.randomUUID() };
    const path = proposal ? "/api/actions/suggestions" : "/api/actions/notes";
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      const result = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": receipt.current.key }, body: draft });
      const data = await result.json();
      if (!result.ok) throw new Error(data.error || "The finding could not be saved.");
      const key = proposal ? data.suggestion?.id : data.note?.id;
      const verify = await fetch(`${path}?${new URLSearchParams(target)}`, { cache: "no-store" });
      if (!verify.ok) throw new Error("Could not confirm the save. Retry to check this same submission.");
      const list = await verify.json();
      const rows = proposal ? list.suggestions : list.notes;
      const item = Array.isArray(rows) && rows.find(row => row.id === key);
      if (!item) throw new Error("Could not confirm the save. Retry to check this same submission.");
      if (!live.current) return;
      receipt.current = { draft: "", key: "" };
      setSaved({ title: proposal ? "Change submitted for approval" : outcome === "missing" ? "Evidence gap saved" : "Finding saved", text: proposal ? item.proposedValue : findingText(item.body)?.text || body.trim() });
      closeEditor();
      setBody(""); setValue(""); setCitation(null); setOutcome("finding");
      if (!reviewing) window.dispatchEvent(new Event("queue-refresh"));
    } catch (cause) {
      if (live.current) setError(cause instanceof Error ? cause.message : "Could not confirm the save. Retry to check this same submission.");
    } finally {
      submitting.current = false;
      if (live.current) setPending(false);
    }
  }

  return <div className="finding-work">
    {confirmation && !(open && writable) && <div className="finding-confirmed" tabIndex={-1} ref={confirmed} role="status"><strong>{confirmation.title}</strong><p>{confirmation.text}</p>
      {reviewing && <button type="button" className="text-link" onClick={() => {
        const back = document.querySelector<HTMLButtonElement>(".review-evidence button");
        if (back) back.click();
        else document.querySelector<HTMLButtonElement>('[data-testid="review-since"]')?.focus();
      }}>Return to review</button>}
    </div>}
    {writable && (open ? <form className="finding-form" aria-label="Record finding" onSubmit={save}>
      <label>Record as<select className="secondary" value={outcome} disabled={pending} onChange={event => setOutcome(event.target.value)}>
        <option value="finding">Finding</option><option value="missing">Missing evidence</option><option value="proposal">Proposed correction</option>
      </select></label>
      {proposal && <><label>Field<select aria-label="Field" className="secondary" value={field} disabled={pending} onChange={event => setField(event.target.value)}>
        <option value="zoning">Zoning</option><option value="owner">Owner</option><option value="address">Address</option><option value="name">Site name</option><option value="next_step">Next step</option>
      </select></label><label>Proposed value<input className="secondary" required maxLength={500} disabled={pending} value={value} onChange={event => setValue(event.target.value)} /></label></>}
      <label>{outcome === "missing" ? "What is still missing?" : "What did you find?"}<textarea className="secondary" rows={2} ref={editor} required maxLength={1600} disabled={pending} value={body} onChange={event => setBody(event.target.value)} /></label>
      <label>Source<input className="secondary" value={citation ?? source} maxLength={1000} disabled={pending} onChange={event => setCitation(event.target.value)} placeholder="Document, link, or source name" /></label>
      {error && <p role="alert" className="err">{error}</p>}
      <div className="finding-buttons"><button className="primary" type="submit" disabled={pending || !body.trim() || (proposal && !value.trim())}>{pending ? "Saving…" : proposal ? "Submit for approval" : outcome === "missing" ? "Save evidence gap" : "Save finding"}</button>
      <button className="text-link" type="button" disabled={pending} onClick={() => { closeEditor(); requestAnimationFrame(() => trigger.current?.focus()); }}>Cancel</button></div>
    </form> : <button ref={trigger} type="button" className={saved ? "text-link" : "primary"} onClick={() => { setSaved(null); setError(""); setOpen(true); }}>{saved ? "Record another finding" : "Record finding"}</button>)}
  </div>;
}
