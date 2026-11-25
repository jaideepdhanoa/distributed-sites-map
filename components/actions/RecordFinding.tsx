"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { currentSearch, rememberSearch } from "@/lib/navSearch";
import type { Note } from "@/lib/actions/notes";
import type { Suggestion } from "@/lib/actions/suggestions";
import type { WorkbookStep } from "@/lib/workbookStep";
import { formatPacific } from "@/lib/actions/time";
import { canWrite, useActionStatus } from "./panel";

type Finding = { id: string; title: string; text: string; source: string; author: string; at: string; gap: boolean };
type NextAction = { text: string; owner: string };
function parseFinding(body: string) {
  const checkAt = body.lastIndexOf("\nCheck: ");
  if (checkAt < 0) return null;
  const first = body.indexOf("\n");
  const mode = body.slice(0, first);
  if (mode !== "Missing evidence" && mode !== "Screening finding") return null;
  const sourceAt = body.indexOf("\nSource: ", checkAt);
  return { text: body.slice(first + 1, checkAt), source: sourceAt < 0 ? "" : body.slice(sourceAt + "\nSource: ".length), gap: mode === "Missing evidence" };
}
function noteFinding(note: Note): Finding | null {
  const parsed = !note.deleted && parseFinding(note.body);
  if (!parsed) return null;
  const gap = parsed.gap && !note.resolvedAt;
  return { ...parsed, gap, id: note.id, title: parsed.gap ? gap ? "Evidence gap saved" : "Evidence gap resolved" : "Finding saved", author: note.authorId, at: note.createdAt };
}
function proposalFinding(item: Suggestion): Finding | null {
  const parsed = item.field === "correction" && parseFinding(item.reason);
  if (!parsed) return null;
  const title = item.status === "open" ? "Change submitted for approval" : "Proposed change · " + item.status;
  return { ...parsed, gap: false, id: item.id, title, text: item.proposedValue + " · " + parsed.text, author: item.authorId, at: item.createdAt };
}
function FindingEntry({ item, action, checking }: { item: Finding; action: NextAction | null; checking: boolean }) {
  const link = /^https?:\/\//i.test(item.source);
  return <>
    <strong>{item.title}</strong><p>{item.text}</p>
    <div className="finding-byline">{item.author} · <time dateTime={item.at}>{formatPacific(item.at)}</time></div>
    <dl className="finding-details"><div><dt>Source</dt><dd>{link ? <a href={item.source} target="_blank" rel="noopener noreferrer">Open source ↗</a> : item.source || "Not recorded"}</dd></div>
      {item.gap && <><div><dt>Next action</dt><dd>{checking ? "Checking…" : action?.text || "No next action recorded"}</dd></div>
      <div><dt>Owner</dt><dd>{checking ? "Checking…" : action?.owner || "Unassigned"}</dd></div></>}
    </dl>
  </>;
}

type FindingProps = {
  kind: "site" | "deal";
  id: string;
  source: string;
  review: string;
  dealId?: string;
  nextStep?: string;
};

export default function RecordFinding({ kind, id, source, review, dealId, nextStep }: FindingProps) {
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
  const [saved, setSaved] = useState<Finding | null>(null);
  const [history, setHistory] = useState<Finding[]>([]);
  const [approved, setApproved] = useState<NextAction | null>(null);
  const [workbook, setWorkbook] = useState<NextAction | null>(null);
  const [loadingOwner, setLoadingOwner] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [retry, setRetry] = useState(0);
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
    async function load() {
      const get = async (path: string, search = query) => {
        const response = await fetch("/api/actions/" + path + "?" + search, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Findings unavailable");
        return (await response.json())[path];
      };
      const [notes, proposals, related] = await Promise.all([
        get("notes") as Promise<Note[]>, get("suggestions") as Promise<Suggestion[]>,
        dealId && dealId !== id ? get("suggestions", new URLSearchParams({ targetKind: "deal", targetId: dealId })) as Promise<Suggestion[]> : [],
      ]);
      if (controller.signal.aborted) return;
      const rows = [...notes.map(noteFinding), ...proposals.map(proposalFinding)].filter((entry): entry is Finding => Boolean(entry));
      setHistory(rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)));
      const step = [...proposals, ...related].filter(item => item.field === "proposed_next_step" && item.status === "accepted" && !item.doneAt)
        .sort((a, b) => (b.decidedAt || "").localeCompare(a.decidedAt || ""))[0];
      setApproved(step ? { text: step.title || step.proposedValue, owner: step.ownerName || step.ownerId || "Unassigned" } : null);
      setHistoryError(false);
    }
    void load().catch(() => { if (!controller.signal.aborted) setHistoryError(true); });
    return () => controller.abort();
  }, [status.enabled, kind, id, dealId, retry]);

  useEffect(() => {
    const refresh = () => setRetry(n => n + 1);
    window.addEventListener("queue-refresh", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("queue-refresh", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  const entries = saved && !history.some(row => row.id === saved.id) ? [saved, ...history] : history;
  const confirmation = entries[0];
  const needsWorkbook = Boolean(status.enabled && dealId && !approved && entries.some(row => row.gap));
  useEffect(() => {
    if (!needsWorkbook || !dealId) return;
    const controller = new AbortController();
    setLoadingOwner(true);
    fetch("/api/data/financials/" + encodeURIComponent(dealId), { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Action unavailable");
      const step: WorkbookStep | null = (await response.json()).workbookStep;
      if (!controller.signal.aborted) setWorkbook(step ? { text: step.text || nextStep || review, owner: step.owner || "Unassigned" } : null);
    }).catch(() => { if (!controller.signal.aborted) setWorkbook({ text: nextStep || review, owner: "Owner unavailable" }); })
      .finally(() => { if (!controller.signal.aborted) setLoadingOwner(false); });
    return () => controller.abort();
  }, [needsWorkbook, dealId, nextStep, review, retry]);
  const action = approved || workbook || { text: nextStep || review, owner: historyError ? "Owner unavailable" : "Unassigned" };
  const writable = status.enabled && canWrite(status.actionRole);
  if (!writable && !confirmation && !historyError) return null;

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
      const entry = proposal ? proposalFinding(item) : noteFinding(item);
      if (!entry) throw new Error("Could not read the saved finding. Try again.");
      receipt.current = { draft: "", key: "" };
      setSaved(entry);
      setHistory(rows => [entry, ...rows.filter(row => row.id !== entry.id)]);
      setRetry(attempt => attempt + 1);
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
    {confirmation && !(open && writable) && <div className="finding-confirmed" tabIndex={-1} ref={confirmed} role="status"><FindingEntry item={confirmation} action={action} checking={needsWorkbook && loadingOwner} />
      {reviewing && <button type="button" className="text-link" onClick={() => {
        const back = document.querySelector<HTMLButtonElement>(".review-evidence button");
        if (back) back.click();
        else document.querySelector<HTMLButtonElement>('[data-testid="review-since"]')?.focus();
      }}>Return to review</button>}
    </div>}
    {entries.length > 1 && !open && <details className="disclosure finding-history"><summary className="disclosure">Earlier findings ({entries.length - 1})</summary>
      <ol>{entries.slice(1).map(entry => <li key={entry.id}><FindingEntry item={entry} action={action} checking={needsWorkbook && loadingOwner} /></li>)}</ol>
    </details>}
    {historyError && <p className="note">Finding history unavailable. <button type="button" className="text-link" onClick={() => setRetry(n => n + 1)}>Retry</button></p>}
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
