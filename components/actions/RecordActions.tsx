"use client";

import { useEffect, useState } from "react";
import { formatPacific, replyCount } from "@/lib/actions/time";
import { canReview, canWrite, useActionStatus, type ActionRole } from "./panel";

type Note = {
  id: string;
  parentId: string | null;
  body: string;
  authorId: string;
  createdAt: string;
  updatedAt: string | null;
  deleted: boolean;
  resolvedAt: string | null;
};
type Suggestion = {
  id: string;
  field: string;
  detail: string | null;
  currentValue: string;
  proposedValue: string;
  reason: string;
  status: string;
  authorId: string;
  createdAt: string;
  decidedAt: string | null;
  title: string | null;
  targetOn: string | null;
  ownerName: string | null;
};
type Account = { id: string; name: string };

const FIELDS: { id: string; label: string }[] = [
  { id: "stage", label: "Stage" },
  { id: "flag", label: "Flag" },
  { id: "correction", label: "Correction" },
  { id: "name", label: "Name" },
  { id: "address", label: "Address" },
  { id: "next_step", label: "Next step" },
  { id: "listed", label: "Listed" },
  { id: "contacted", label: "Contacted" },
  { id: "asking_price_display", label: "Asking price" },
  { id: "asking_price_source", label: "Asking price source" },
];

const COLUMNS: { id: string; label: string }[] = [
  { id: "name", label: "Name" },
  { id: "address", label: "Address" },
  { id: "stage", label: "Stage" },
  { id: "pipeline_stage", label: "Pipeline stage" },
  { id: "next_step", label: "Next step" },
  { id: "zoning", label: "Zoning" },
  { id: "owner", label: "Owner" },
  { id: "asking_price_display", label: "Asking price" },
  { id: "asking_price_source", label: "Asking price source" },
];

function fieldLabel(id: string) {
  if (id === "proposed_next_step") return "Proposed next step";
  return FIELDS.find((item) => item.id === id)?.label || COLUMNS.find((item) => item.id === id)?.label || id;
}

export function RecordActions({ kind, id }: { kind: "site" | "deal"; id: string }) {
  const status = useActionStatus();
  const [notes, setNotes] = useState<Note[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [note, setNote] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [stepTitle, setStepTitle] = useState("");
  const [stepDate, setStepDate] = useState("");
  const [stepOwner, setStepOwner] = useState("");
  const [field, setField] = useState("stage");
  const [detail, setDetail] = useState("name");
  const [proposed, setProposed] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const writable = canWrite(status.actionRole);
  const reviewer = canReview(status.actionRole);

  async function reload() {
    const query = new URLSearchParams({ targetKind: kind, targetId: id });
    const [notesRes, suggestionsRes] = await Promise.all([
      fetch(`/api/actions/notes?${query}`),
      fetch(`/api/actions/suggestions?${query}`),
    ]);
    if (notesRes.ok) setNotes(((await notesRes.json()) as { notes: Note[] }).notes || []);
    if (suggestionsRes.ok) setSuggestions(((await suggestionsRes.json()) as { suggestions: Suggestion[] }).suggestions || []);
  }

  useEffect(() => {
    if (!status.enabled) return;
    let cancel = false;
    const query = new URLSearchParams({ targetKind: kind, targetId: id });
    Promise.all([
      fetch(`/api/actions/notes?${query}`),
      fetch(`/api/actions/suggestions?${query}`),
      fetch("/api/actions/accounts"),
    ]).then(async ([notesRes, suggestionsRes, accountsRes]) => {
      if (cancel) return;
      if (notesRes.ok) setNotes(((await notesRes.json()) as { notes: Note[] }).notes || []);
      if (suggestionsRes.ok) setSuggestions(((await suggestionsRes.json()) as { suggestions: Suggestion[] }).suggestions || []);
      if (accountsRes.ok) setAccounts(((await accountsRes.json()) as { accounts: Account[] }).accounts || []);
    }).catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [status.enabled, kind, id]);

  if (!status.enabled) return null;

  async function submit(path: string, body: unknown, clear: () => void, method = "POST") {
    setPending(true);
    setError("");
    const response = await fetch(path, {
      method,
      headers: body == null ? undefined : { "Content-Type": "application/json" },
      body: body == null ? undefined : JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    setPending(false);
    if (!response.ok) {
      setError(payload.error || "That could not be saved.");
      return;
    }
    clear();
    await reload();
  }

  const openCount = suggestions.filter((item) => item.status === "open").length;
  const openProposals = suggestions.filter((item) => item.field === "proposed_next_step" && item.status === "open").length;
  const approvedSteps = suggestions
    .filter((item) => item.field === "proposed_next_step" && item.status === "accepted")
    .sort((a, b) => (b.decidedAt || "").localeCompare(a.decidedAt || ""));
  const currentStep = approvedSteps[0];
  const earlierSteps = approvedSteps.slice(1);
  const roots = notes.filter((item) => !item.parentId);

  return (
    <section className="act" data-testid="record-actions">
      <div data-testid="next-step">
        <h3>Next step</h3>
        {currentStep ? (
          <p>
            <strong>{currentStep.title || currentStep.proposedValue}</strong>
            {currentStep.targetOn ? ` · ${currentStep.targetOn}` : ""}
            {currentStep.ownerName ? ` · ${currentStep.ownerName}` : ""}
          </p>
        ) : (
          <p className="note">No approved next step.</p>
        )}
        {earlierSteps.length ? (
          <details>
            <summary>Earlier next steps ({earlierSteps.length})</summary>
            <ul className="act-list">
              {earlierSteps.map((item) => (
                <li key={item.id}>
                  <p>{item.title || item.proposedValue}{item.targetOn ? ` · ${item.targetOn}` : ""}</p>
                  <p className="note">{item.ownerName || item.authorId} · approved {item.decidedAt ? formatPacific(item.decidedAt) : ""}</p>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      <h3>Notes</h3>
      {roots.length ? (
        <div className="act-threads" data-testid="note-threads">
          {roots.map((item) => (
            <NoteThread
              key={item.id}
              note={item}
              replies={notes.filter((reply) => reply.parentId === item.id)}
              writable={writable}
              reviewer={reviewer}
              pending={pending}
              onReply={(parentId, body) => submit("/api/actions/notes", { targetKind: kind, targetId: id, parentId, body }, () => undefined)}
              onEdit={(noteId, body) => submit(`/api/actions/notes/${noteId}`, { body }, () => undefined, "PATCH")}
              onDelete={(noteId) => submit(`/api/actions/notes/${noteId}`, null, () => undefined, "DELETE")}
              onResolve={(noteId) => submit(`/api/actions/notes/${noteId}/resolve`, {}, () => undefined)}
              actor={status.username}
            />
          ))}
        </div>
      ) : (
        <p className="note">No notes yet.</p>
      )}
      {writable ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit("/api/actions/notes", { targetKind: kind, targetId: id, body: note }, () => setNote(""));
          }}
        >
          <label>
            Note
            <textarea data-testid="note-body" value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={2000} />
          </label>
          <button type="submit" disabled={pending}>Save note</button>
        </form>
      ) : (
        <p className="note">Notes are read only for this login.</p>
      )}
      {writable ? (
        <form
          data-testid="next-step-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(
              "/api/actions/suggestions",
              { targetKind: kind, targetId: id, field: "proposed_next_step", title: stepTitle, targetOn: stepDate, ownerId: stepOwner, proposedValue: stepTitle },
              () => {
                setStepTitle("");
                setStepDate("");
                setStepOwner("");
              },
            );
          }}
        >
          <h3>Propose a next step</h3>
          <label>
            Title
            <input data-testid="next-step-title" value={stepTitle} onChange={(event) => setStepTitle(event.target.value)} maxLength={120} />
          </label>
          <label>
            Target date
            <input type="date" aria-label="Target date" value={stepDate} onChange={(event) => setStepDate(event.target.value)} />
          </label>
          <label>
            Owner
            <select aria-label="Owner" value={stepOwner} onChange={(event) => setStepOwner(event.target.value)}>
              <option value="">Unassigned</option>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
          </label>
          <button type="submit" disabled={pending}>Propose next step</button>
        </form>
      ) : null}

      <h3>Suggestions {openCount ? <span className="badge pending">{openCount} open</span> : null} {openProposals ? <span className="badge pending">{openProposals} open proposals</span> : null}</h3>
      <p className="note">A suggestion does not change the map. Someone applies it in the workbook.</p>
      {suggestions.length ? (
        <ul className="act-list">
          {suggestions.map((item) => (
            <li key={item.id}>
              <p>
                <strong>{fieldLabel(item.field)}{item.detail ? ` · ${fieldLabel(item.detail)}` : ""}:</strong> {item.proposedValue}
                {" "}
                <span className={`badge ${item.status === "open" ? "pending" : "checked"}`}>{item.status}</span>
              </p>
              <p>{item.reason}</p>
              <p className="note">{item.authorId} · {formatPacific(item.createdAt)}{item.currentValue ? ` · was ${item.currentValue}` : ""}</p>
              {reviewer && item.status === "open" ? (
                <div className="act-row">
                  <button type="button" onClick={() => void submit(`/api/actions/suggestions/${item.id}`, { status: "accepted" }, () => undefined)}>Accept</button>
                  <button type="button" onClick={() => void submit(`/api/actions/suggestions/${item.id}`, { status: "rejected" }, () => undefined)}>Reject</button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="note">No suggestions on this record.</p>
      )}
      {writable ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit(
              "/api/actions/suggestions",
              { targetKind: kind, targetId: id, field, detail: field === "correction" ? detail : undefined, proposedValue: proposed, reason },
              () => {
                setProposed("");
                setReason("");
              },
            );
          }}
        >
          <label>
            Field
            <select aria-label="Field" value={field} onChange={(event) => setField(event.target.value)}>
              {FIELDS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          {field === "correction" ? (
            <label>
              Column
              <select aria-label="Column" value={detail} onChange={(event) => setDetail(event.target.value)}>
                {COLUMNS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
          ) : null}
          <label>
            Proposed value
            <input data-testid="proposed-value" value={proposed} onChange={(event) => setProposed(event.target.value)} maxLength={500} />
          </label>
          <label>
            Reason
            <textarea data-testid="suggest-reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={2000} />
          </label>
          <button type="submit" data-testid="suggest-change" disabled={pending}>Suggest a change</button>
        </form>
      ) : null}
      {error ? <p className="err" role="alert" data-testid="action-error">{error}</p> : null}
      <RoleLine role={status.actionRole} />
    </section>
  );
}

function NoteThread({
  note,
  replies,
  writable,
  reviewer,
  pending,
  actor,
  onReply,
  onEdit,
  onDelete,
  onResolve,
}: {
  note: Note;
  replies: Note[];
  writable: boolean;
  reviewer: boolean;
  pending: boolean;
  actor: string;
  onReply: (parentId: string, body: string) => void;
  onEdit: (id: string, body: string) => void;
  onDelete: (id: string) => void;
  onResolve: (id: string) => void;
}) {
  const [reply, setReply] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [confirming, setConfirming] = useState(false);
  return (
    <details className="act-thread" open={!note.resolvedAt} data-testid="note-thread">
      <summary>
        {note.authorId} · {formatPacific(note.createdAt)}
        {note.resolvedAt ? " · Resolved" : replies.length ? ` · ${replyCount(replies.length)}` : ""}
      </summary>
      {note.deleted ? <p className="note">Removed</p> : editing ? (
        <form onSubmit={(event) => { event.preventDefault(); onEdit(note.id, draft); setEditing(false); }}>
          <textarea aria-label="Edit note" value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} maxLength={2000} />
          <button type="submit" disabled={pending}>Save edit</button>
        </form>
      ) : (
        <p>{note.body}{note.updatedAt ? <span className="note"> · edited</span> : null}</p>
      )}
      <div className="act-row">
        {writable && actor === note.authorId && !note.deleted ? (
          <>
            <button type="button" onClick={() => { setEditing((value) => !value); setDraft(note.body); }}>Edit</button>
            {confirming ? (
              <button type="button" onClick={() => onDelete(note.id)}>Confirm remove</button>
            ) : (
              <button type="button" onClick={() => setConfirming(true)}>Remove</button>
            )}
          </>
        ) : null}
        {reviewer && !note.resolvedAt && !note.deleted ? (
          <button type="button" onClick={() => onResolve(note.id)}>Resolve</button>
        ) : null}
      </div>
      {replies.length ? (
        <ul className="act-replies">
          {replies.map((replyNote) => (
            <ReplyLine key={replyNote.id} note={replyNote} actor={actor} writable={writable} pending={pending} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </ul>
      ) : null}
      {writable && !note.deleted ? (
        <form onSubmit={(event) => { event.preventDefault(); onReply(note.id, reply); setReply(""); }}>
          <label>
            Reply
            <textarea data-testid="note-reply" value={reply} onChange={(event) => setReply(event.target.value)} rows={2} maxLength={2000} />
          </label>
          <button type="submit" disabled={pending}>Reply</button>
        </form>
      ) : null}
    </details>
  );
}

function ReplyLine({
  note,
  actor,
  writable,
  pending,
  onEdit,
  onDelete,
}: {
  note: Note;
  actor: string;
  writable: boolean;
  pending: boolean;
  onEdit: (id: string, body: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [confirming, setConfirming] = useState(false);
  return (
    <li>
      {note.deleted ? <p className="note">Removed</p> : editing ? (
        <form onSubmit={(event) => { event.preventDefault(); onEdit(note.id, draft); setEditing(false); }}>
          <textarea aria-label="Edit reply" value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} maxLength={2000} />
          <button type="submit" disabled={pending}>Save edit</button>
        </form>
      ) : (
        <p>{note.body}</p>
      )}
      <p className="note">{note.authorId} · {formatPacific(note.createdAt)}{note.updatedAt ? " · edited" : ""}</p>
      {writable && actor === note.authorId && !note.deleted ? (
        <div className="act-row">
          <button type="button" onClick={() => { setEditing((value) => !value); setDraft(note.body); }}>Edit</button>
          {confirming ? (
            <button type="button" onClick={() => onDelete(note.id)}>Confirm remove</button>
          ) : (
            <button type="button" onClick={() => setConfirming(true)}>Remove</button>
          )}
        </div>
      ) : null}
    </li>
  );
}

function RoleLine({ role }: { role: ActionRole }) {
  const text = role === "reviewer"
    ? "You can accept or reject suggestions."
    : role === "contributor"
      ? "You can add notes and suggestions."
      : "You can read notes and suggestions.";
  return <p className="note">{text}</p>;
}
