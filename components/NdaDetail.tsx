"use client";

import { useEffect, useState } from "react";
import Timeline from "./timeline/Timeline";
import CommentThread from "./comments/CommentThread";
import { ndaAnchor } from "@/lib/comments/anchor";
import { coveredSites, stageLabel, type NdaQueueItem } from "@/lib/nda";

const STAGES = [
  "requested",
  "our_form_sent",
  "their_form_received",
  "redline_with_them",
  "redline_with_us",
  "with_moove_legal",
  "routing_for_signature",
  "counterparty_signed",
  "executed",
  "financials_requested",
  "financials_received",
  "deferred",
  "declined",
  "not_required",
  "expired",
] as const;

const COURTS = [
  ["us", "Our court"],
  ["them", "Their court"],
  ["seller", "Seller"],
  ["none", "None"],
] as const;

const KINDS = ["docusign", "clm", "drive", "email", "other"] as const;

type Account = { id: string; name: string };

async function postNda(row: NdaQueueItem, payload: Record<string, unknown>) {
  const response = await fetch("/api/changes", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      changes: [{
        entity_type: "nda",
        site_id: row.nda_id,
        expected_version: row.version || 0,
        source: "NDA queue",
        payload: { ...payload, at: new Date().toISOString() },
      }],
    }),
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error || "That change was not saved.");
}

export default function NdaDetail({
  row,
  today,
  onOpenSite,
  onSaved,
  onBack,
  backLabel,
}: {
  row: NdaQueueItem;
  today: string;
  onOpenSite: (id: string) => void;
  onSaved: () => void;
  onBack: () => void;
  backLabel: string;
}) {
  const covered = coveredSites(row.site_ids || "");
  const sites = Array.from(new Set([...covered.ids, ...(row.covered_refs || []).filter((item) => /^(?:PIPE|LAND)-/.test(item))]));
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editing, setEditing] = useState(false);
  const [stage, setStage] = useState(row.stage || "requested");
  const [court, setCourt] = useState(row.court || "none");
  const [owner, setOwner] = useState(row.owner || "");
  const [nextStep, setNextStep] = useState(row.next_step || "");
  const [due, setDue] = useState(row.next_step_due || "");
  const [documentUrl, setDocumentUrl] = useState(row.document_url || "");
  const [documentKind, setDocumentKind] = useState(row.document_kind || "other");
  const [contactName, setContactName] = useState(row.contact_name || "");
  const [contactEmail, setContactEmail] = useState(row.contact_email || "");
  const [contactPhone, setContactPhone] = useState(row.contact_phone || "");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const overdue = Boolean(row.next_step_due && row.next_step_due < today);
  const stageChanged = stage !== (row.stage || "");

  useEffect(() => {
    let cancel = false;
    fetch("/api/actions/accounts")
      .then(async (response) => (response.ok ? await response.json() as { accounts?: Account[] } : { accounts: [] }))
      .then((body) => {
        if (!cancel) setAccounts(body.accounts || []);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, []);

  async function save() {
    if (stageChanged && !note.trim()) {
      setError("A status change needs a note.");
      return;
    }
    setPending(true);
    setError("");
    try {
      await postNda(row, {
        action: "edit",
        stage,
        status: stageLabel(stage),
        court,
        owner,
        next_step: nextStep,
        next_step_due: due,
        document_url: documentUrl,
        document_kind: documentKind,
        contact_name: contactName,
        contact_email: contactEmail,
        contact_phone: contactPhone,
        note,
        source_ref: "nda-dossier",
      });
      setEditing(false);
      setNote("");
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That change was not saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="nda-detail" data-testid="nda-detail">
      <div className="layers-bar nda-bar">
        <div>
          <button type="button" className="text-link" data-testid="nda-back" onClick={onBack}>{backLabel}</button>
          <h2>{row.counterparty_firm || row.nda_id}</h2>
          <p className="note">{row.nda_id}</p>
        </div>
      </div>
      <div className="nda-dossier">
        <div>
          {row.conflict ? <p className="note" data-testid="nda-conflict">{row.conflict}</p> : null}
          <h3>Facts</h3>
          <div className="kv">
            <span>Contact</span><div>{[row.contact_name, row.contact_email, row.contact_phone].filter(Boolean).join(" · ") || "—"}</div>
            <span>Scope</span><div>{row.scope || covered.note || "—"}</div>
            <span>Stage</span><div>{stageLabel(row.stage) || "—"}{row.nda_status && row.nda_status !== stageLabel(row.stage) ? ` · Register: ${row.nda_status}` : ""}</div>
            <span>Court</span><div>{row.court_pill || "—"}{row.court_since ? ` · since ${row.court_since.slice(0, 10)}` : ""}{row.court_detail ? ` · ${row.court_detail}` : ""}</div>
            <span>Owner</span><div>{row.owner || "Unassigned"}</div>
            <span>Next step</span><div className={overdue ? "nda-overdue" : ""}>{row.next_step || "—"}{row.next_step_due ? ` · ${row.next_step_due}` : ""}</div>
            <span>Document</span><div>{row.document_url ? <a href={row.document_url} target="_blank" rel="noopener noreferrer">{row.document_kind || "Open"}</a> : "—"}</div>
          </div>
          {row.notes ? <><h3>Register notes</h3><p>{row.notes}</p></> : null}
          {row.nda_gates ? <><h3>Gates</h3><p>{row.nda_gates}</p></> : null}
          <h3>Covered listings</h3>
          {sites.length ? sites.map((id) => (
            <p key={id}><button type="button" className="text-link" onClick={() => onOpenSite(id)}>{id}</button></p>
          )) : <p>{row.scope || covered.note || "No site row"}</p>}
          <h3>Status history</h3>
          <ol className="nda-history" data-testid="nda-history">
            {row.history.map((item, index) => (
              <li key={`${item.at}-${index}`}>{item.status || "—"}{item.at ? ` · ${item.at.slice(0, 10)}` : ""}{item.note ? ` · ${item.note}` : ""}</li>
            ))}
          </ol>
          <button type="button" className="paper-btn" data-testid="nda-edit" onClick={() => setEditing((value) => !value)}>{editing ? "Close edit" : "Edit"}</button>
          {editing ? (
            <form className="nda-edit" data-testid="nda-edit-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
              <label>Stage<select className="secondary" aria-label="Stage" value={stage} onChange={(event) => setStage(event.target.value)}>{STAGES.map((item) => <option key={item} value={item}>{stageLabel(item)}</option>)}</select></label>
              <label>Court<select className="secondary" aria-label="Court" value={court} onChange={(event) => setCourt(event.target.value)}>{COURTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
              <label>Owner<select className="secondary" aria-label="NDA owner" value={owner} onChange={(event) => setOwner(event.target.value)}><option value="">Unassigned</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
              <label>Next step<input className="field" aria-label="Next step" value={nextStep} onChange={(event) => setNextStep(event.target.value)} /></label>
              <label>Due<input className="field" aria-label="Next step due" type="date" value={due} onChange={(event) => setDue(event.target.value)} /></label>
              <label>Document<input className="field" aria-label="Document link" value={documentUrl} onChange={(event) => setDocumentUrl(event.target.value)} /></label>
              <label>Kind<select className="secondary" aria-label="Document kind" value={documentKind} onChange={(event) => setDocumentKind(event.target.value)}>{KINDS.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
              <label>Contact<input className="field" aria-label="Contact name" value={contactName} onChange={(event) => setContactName(event.target.value)} /></label>
              <label>Email<input className="field" aria-label="Contact email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} /></label>
              <label>Phone<input className="field" aria-label="Contact phone" value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} /></label>
              <label>Note<textarea className="field" aria-label="Status note" value={note} onChange={(event) => setNote(event.target.value)} rows={3} /></label>
              <button type="submit" className="paper-btn" data-testid="nda-save" disabled={pending}>Save</button>
            </form>
          ) : null}
          {error ? <p className="note" role="alert">{error}</p> : null}
        </div>
        <div>
          <h3>Activity</h3>
          {sites.length ? <Timeline recordId={sites[0]} /> : <p className="note" data-testid="nda-no-site">No site row. Threads stay on this NDA.</p>}
          {row.gmail_thread_ids.length ? <p className="note">Threads: {row.gmail_thread_ids.join(", ")}</p> : null}
          <section data-testid="nda-discussion">
            <h3>Discussion</h3>
            <CommentThread siteId={row.nda_id} anchor={ndaAnchor(row.nda_id)} variant="inline" source="NDA" />
          </section>
        </div>
      </div>
    </div>
  );
}
