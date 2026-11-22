"use client";

import { useEffect, useState } from "react";
import Timeline from "./timeline/Timeline";
import CommentThread from "./comments/CommentThread";
import { ndaAnchor } from "@/lib/comments/anchor";
import { brokerFollowUp } from "@/lib/ndaDraft";
import { coveredSites, queueCourt, type NdaQueueItem } from "@/lib/nda";

const STATUSES = [
  "With counterparty legal",
  "With Moove legal",
  "Moove form sent",
  "Broker asked — send our form",
  "Executed",
  "Declined / proceeding without",
  "Expired",
  "Not required",
];

type Account = { id: string; name: string };

async function postNda(row: NdaQueueItem, payload: Record<string, string>) {
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
  onClose,
  onOpenSite,
  onSaved,
  onBack,
  backLabel,
}: {
  row: NdaQueueItem;
  onClose: () => void;
  onOpenSite: (id: string) => void;
  onSaved: () => void;
  onBack: () => void;
  backLabel: string;
}) {
  const sites = coveredSites(row.site_ids || "").ids;
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [status, setStatus] = useState(row.nda_status || STATUSES[0]);
  const [court, setCourt] = useState(queueCourt(row) === "—" ? "" : queueCourt(row));
  const [note, setNote] = useState("");
  const [owner, setOwner] = useState(row.owner || "");
  const [nextStep, setNextStep] = useState(row.next_step || "");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const choices = STATUSES.includes(status) ? STATUSES : [status, ...STATUSES];

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

  async function save(payload: Record<string, string>) {
    if (payload.action === "status" && !payload.note.trim()) {
      setError("A status change needs a note.");
      return;
    }
    setPending(true);
    setError("");
    try {
      await postNda(row, payload);
      setNote("");
      setDraft("");
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
          <h2>{row.nda_id}</h2>
        </div>
        <button type="button" className="close" aria-label="Close NDA" onClick={onClose}><span aria-hidden="true">×</span></button>
      </div>
      <section>
        <h3>Status history</h3>
        <ol className="nda-history" data-testid="nda-history">
          {row.history.map((item, index) => (
            <li key={`${item.at}-${index}`}>
              <p>{item.status || "—"}{item.at ? ` · ${item.at}` : ""}</p>
              {item.note ? <p>{item.note}</p> : null}
              {item.actor ? <p>{item.actor}</p> : null}
            </li>
          ))}
        </ol>
      </section>
      <section>
        <h3>Covered sites</h3>
        {sites.length ? (
          <div className="nda-sites">
            {sites.map((id) => (
              <button key={id} type="button" className="text-link" onClick={() => onOpenSite(id)}>{id}</button>
            ))}
          </div>
        ) : <p className="note">No Pipeline or Land row yet</p>}
      </section>
      <section className="nda-actions">
        <h3>Change status</h3>
        <label>
          Status
          <select className="secondary" aria-label="NDA status" value={status} onChange={(event) => setStatus(event.target.value)}>
            {choices.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>
          Waiting on
          <input className="field" aria-label="Waiting on" value={court} onChange={(event) => setCourt(event.target.value)} maxLength={80} />
        </label>
        <label>
          Note
          <textarea className="field" aria-label="Status note" required value={note} onChange={(event) => setNote(event.target.value)} maxLength={400} rows={3} />
        </label>
        <button type="button" className="paper-btn" disabled={pending || !note.trim()} onClick={() => void save({ action: "status", status, waiting_on: court, note })}>Save status</button>
        <h3>Assign owner</h3>
        <label>
          Owner
          <select className="secondary" aria-label="NDA owner" value={owner} onChange={(event) => setOwner(event.target.value)}>
            <option value="">Unassigned</option>
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
        </label>
        <button type="button" className="paper-btn" disabled={pending || !owner} onClick={() => void save({ action: "assign", owner })}>Assign owner</button>
        <h3>Next step</h3>
        <label>
          Next step
          <input className="field" aria-label="Next step" value={nextStep} onChange={(event) => setNextStep(event.target.value)} maxLength={400} />
        </label>
        <button type="button" className="paper-btn" disabled={pending || !nextStep.trim()} onClick={() => void save({ action: "next_step", next_step: nextStep })}>Save next step</button>
        {error ? <p className="note" role="alert">{error}</p> : null}
      </section>
      <section>
        <h3>Email</h3>
        {sites.length ? sites.slice(0, 4).map((id) => (
          <div key={id}>
            <button type="button" className="text-link" onClick={() => onOpenSite(id)}>{id}</button>
            <Timeline recordId={id} />
          </div>
        )) : <p className="note">No linked mail until a site is covered.</p>}
      </section>
      <section data-testid="nda-discussion">
        <h3>Discussion</h3>
        <CommentThread siteId={row.nda_id} anchor={ndaAnchor(row.nda_id)} variant="inline" source="NDA" />
      </section>
      <section>
        <h3>Follow-up</h3>
        <button type="button" className="paper-btn" data-testid="nda-draft" onClick={() => setDraft(brokerFollowUp(row))}>Draft follow-up</button>
        {draft ? (
          <>
            <textarea className="field" aria-label="Follow-up draft" readOnly value={draft} rows={8} data-testid="nda-draft-text" />
            <button
              type="button"
              className="paper-btn"
              onClick={() => { void navigator.clipboard?.writeText(draft); }}
            >
              Copy draft
            </button>
          </>
        ) : null}
      </section>
    </div>
  );
}
