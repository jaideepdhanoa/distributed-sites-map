"use client";

import { useEffect, useState } from "react";
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
type Mail = { id: string; at: string; title: string; href: string };

const GENERIC = /^(discussion|site-specific|broker-level|none|—|-)$/i;

function noteEntries(notes: string): string[] {
  const parts = notes.split(/(?=(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2})/i).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return notes.trim() ? [notes.trim()] : [];
  return parts.reverse();
}

function NdaMail({ sites, threads }: { sites: string[]; threads: string[] }) {
  const [rows, setRows] = useState<Mail[]>([]);
  const [pending, setPending] = useState(Boolean(sites.length));
  useEffect(() => {
    if (!sites.length) {
      setRows([]);
      setPending(false);
      return undefined;
    }
    let cancel = false;
    setPending(true);
    Promise.all(sites.map(async (id) => {
      const response = await fetch(`/api/data/comms?id=${encodeURIComponent(id)}`);
      if (!response.ok) return [] as Mail[];
      const body = await response.json() as { rows?: { commsId?: string; at?: string; direction?: string; channel?: string; person?: string; summary?: string; href?: string; messageId?: string }[] };
      return (body.rows || []).map((item) => ({
        id: item.messageId || item.commsId || item.at || id,
        at: item.at || "",
        title: [item.direction, item.channel, item.person].filter(Boolean).join(" · ") || "Email",
        href: item.href || "",
      }));
    })).then((groups) => {
      if (cancel) return;
      const seen = new Set<string>();
      const merged = groups.flat().filter((item) => {
        if (!item.id || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      }).sort((left, right) => right.at.localeCompare(left.at));
      const matched = threads.length
        ? merged.filter((item) => threads.some((thread) => item.id.includes(thread) || item.href.includes(thread)))
        : [];
      setRows(matched.length ? matched : merged);
      setPending(false);
    }).catch(() => {
      if (!cancel) setPending(false);
    });
    return () => {
      cancel = true;
    };
  }, [sites.join("|"), threads.join("|")]);
  if (!sites.length) return <p className="note" data-testid="nda-no-site">No site row. {threads.length ? `Threads stay on this NDA (${threads.length}).` : "No email is linked yet."}</p>;
  if (pending) return <p className="note">Loading email.</p>;
  if (!rows.length) return <p className="note">No email on this NDA yet.</p>;
  return (
    <ul className="nda-mail">
      {rows.map((item) => (
        <li key={item.id}>
          <p>{item.at ? `${item.at} · ` : ""}{item.title}</p>
          {item.href ? <a className="text-link" href={item.href} target="_blank" rel="noopener noreferrer">Open in Gmail ↗</a> : null}
        </li>
      ))}
    </ul>
  );
}

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
  names = {},
  onOpenSite,
  onSaved,
  onBack,
  backLabel,
}: {
  row: NdaQueueItem;
  today: string;
  names?: Record<string, string>;
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
  const [notesOpen, setNotesOpen] = useState(false);
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

  const scopeText = GENERIC.test(row.scope || "") ? (covered.note || "No site row") : (row.scope || covered.note || "—");
  const gateText = GENERIC.test(row.nda_gates || "") ? "" : row.nda_gates;
  const notes = noteEntries(row.notes || "");
  const shownNotes = notesOpen ? notes : notes.slice(0, 4);
  return (
    <div className="nda-detail" data-testid="nda-detail">
      <div className="layers-bar nda-bar">
        <div className="nda-backline">
          <button type="button" className="text-link" data-testid="nda-back" onClick={onBack}>{backLabel}</button>
          <h2>{row.counterparty_firm || row.nda_id}</h2>
          <span className="note">{row.nda_id}</span>
        </div>
        <button type="button" className="paper-btn" data-testid="nda-edit" onClick={() => setEditing(true)}>Edit</button>
      </div>
      <div className="nda-dossier">
        <div>
          {row.conflict ? <p className="note" data-testid="nda-conflict">{row.conflict}</p> : null}
          <h3>Facts</h3>
          <div className="kv">
            <span>Contact</span><div>{row.contact_name || "No contact name"}</div>
            <span>Email</span><div className={row.contact_email ? "" : "note"}>{row.contact_email || "No email on file"}</div>
            <span>Phone</span><div className={row.contact_phone ? "" : "note"}>{row.contact_phone || "No phone on file"}</div>
            <span>Scope</span><div>{scopeText}</div>
            <span>Stage</span><div>{stageLabel(row.stage) || "—"}{row.nda_status && row.nda_status !== stageLabel(row.stage) ? ` · Register: ${row.nda_status}` : ""}</div>
            <span>Court</span><div><span className={`court-pill ${row.court === "us" ? "us" : "them"}`}>{row.court_pill || "No court"}</span>{row.court_since ? ` · since ${row.court_since.slice(0, 10)}` : ""}</div>
            <span>Owner</span><div>{row.owner || "Unassigned"}</div>
            <span>Next step</span><div className={overdue ? "nda-overdue" : ""}>{row.next_step || "No next step"}{row.next_step_due ? ` · ${row.next_step_due}` : ""}</div>
            <span>Document</span><div className={row.document_url ? "" : "note"}>{row.document_url ? <a className="text-link" href={row.document_url} target="_blank" rel="noopener noreferrer">{row.document_kind || "Open document"}</a> : "No document yet"}</div>
          </div>
          {gateText ? <><h3>Gates</h3><p>{gateText}</p></> : null}
          <h3>Covered listings</h3>
          {sites.length ? sites.map((id) => (
            <p key={id}><button type="button" className="text-link" onClick={() => onOpenSite(id)}>{names[id] || "Covered site"}</button></p>
          )) : <p>{covered.note || scopeText}</p>}
          <h3>Status history</h3>
          <ol className="nda-history" data-testid="nda-history">
            {row.history.map((item, index) => (
              <li key={`${item.at}-${index}`}>{item.status || "—"}{item.at ? ` · ${item.at.slice(0, 10)}` : ""}{item.note ? ` · ${item.note}` : ""}</li>
            ))}
          </ol>
          {notes.length ? (
            <>
              <h3>Register notes</h3>
              <ul className="nda-notes">
                {shownNotes.map((entry) => <li key={entry.slice(0, 40)}>{entry}</li>)}
              </ul>
              {notes.length > 4 ? <button type="button" className="text-link" onClick={() => setNotesOpen((value) => !value)}>{notesOpen ? "Show less" : "Show all"}</button> : null}
            </>
          ) : null}
          {error ? <p className="note" role="alert">{error}</p> : null}
        </div>
        <div>
          <h3>Activity</h3>
          <NdaMail sites={sites} threads={row.gmail_thread_ids} />
        </div>
      </div>
      <section className="nda-discussion" data-testid="nda-discussion">
        <h3>Discussion</h3>
        <CommentThread siteId={row.nda_id} anchor={ndaAnchor(row.nda_id)} variant="inline" source="NDA" />
      </section>
      {editing ? (
        <div className="nda-edit-sheet" role="dialog" aria-label="Edit NDA" data-testid="nda-edit-form">
          <div className="layers-bar">
            <h2>Edit</h2>
            <button type="button" className="close" aria-label="Cancel edit" onClick={() => setEditing(false)}><span aria-hidden="true">×</span></button>
          </div>
          <form className="nda-edit" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <label>Stage<select className="secondary" aria-label="Stage" value={stage} onChange={(event) => setStage(event.target.value)}>{STAGES.map((item) => <option key={item} value={item}>{stageLabel(item)}</option>)}</select></label>
            <label>Court<select className="secondary" aria-label="Court" value={court} onChange={(event) => setCourt(event.target.value)}>{COURTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
            <label>Owner<select className="secondary" aria-label="NDA owner" value={owner} onChange={(event) => setOwner(event.target.value)}><option value="">Unassigned</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
            <label>Due<input className="field" aria-label="Next step due" type="date" value={due} onChange={(event) => setDue(event.target.value)} /></label>
            <label className="wide">Next step<input className="field" aria-label="Next step" value={nextStep} onChange={(event) => setNextStep(event.target.value)} /></label>
            <label>Document<input className="field" aria-label="Document link" value={documentUrl} onChange={(event) => setDocumentUrl(event.target.value)} /></label>
            <label>Kind<select className="secondary" aria-label="Document kind" value={documentKind} onChange={(event) => setDocumentKind(event.target.value)}>{KINDS.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <label>Contact<input className="field" aria-label="Contact name" value={contactName} onChange={(event) => setContactName(event.target.value)} /></label>
            <label>Email<input className="field" aria-label="Contact email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} /></label>
            <label>Phone<input className="field" aria-label="Contact phone" value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} /></label>
            <label className="wide">Note<textarea className="field" aria-label="Status note" value={note} onChange={(event) => setNote(event.target.value)} rows={3} /></label>
            <div className="nda-edit-bar">
              <button type="button" className="paper-btn" onClick={() => setEditing(false)}>Cancel</button>
              <button type="submit" className="paper-btn" data-testid="nda-save" disabled={pending}>Save</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
