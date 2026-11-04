"use client";

import { useEffect, useState } from "react";
import { canReview, canWrite, useActionStatus, type ActionRole } from "./panel";

type Note = { id: string; body: string; authorId: string; createdAt: string };
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
};

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

function when(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 16).replace("T", " ");
}

function fieldLabel(id: string) {
  return FIELDS.find((item) => item.id === id)?.label || COLUMNS.find((item) => item.id === id)?.label || id;
}

export function RecordActions({ kind, id }: { kind: "site" | "deal"; id: string }) {
  const status = useActionStatus();
  const [notes, setNotes] = useState<Note[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [note, setNote] = useState("");
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
    Promise.all([fetch(`/api/actions/notes?${query}`), fetch(`/api/actions/suggestions?${query}`)]).then(async ([notesRes, suggestionsRes]) => {
      if (cancel) return;
      if (notesRes.ok) setNotes(((await notesRes.json()) as { notes: Note[] }).notes || []);
      if (suggestionsRes.ok) setSuggestions(((await suggestionsRes.json()) as { suggestions: Suggestion[] }).suggestions || []);
    }).catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [status.enabled, kind, id]);

  if (!status.enabled) return null;

  async function submit(path: string, body: unknown, clear: () => void) {
    setPending(true);
    setError("");
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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

  return (
    <section className="act" data-testid="record-actions">
      <h3>Notes</h3>
      {notes.length ? (
        <ul className="act-list">
          {notes.map((item) => (
            <li key={item.id}>
              <p>{item.body}</p>
              <p className="note">{item.authorId} · {when(item.createdAt)}</p>
            </li>
          ))}
        </ul>
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

      <h3>Suggestions {openCount ? <span className="badge pending">{openCount} open</span> : null}</h3>
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
              <p className="note">{item.authorId} · {when(item.createdAt)}{item.currentValue ? ` · was ${item.currentValue}` : ""}</p>
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

function RoleLine({ role }: { role: ActionRole }) {
  const text = role === "reviewer"
    ? "You can accept or reject suggestions."
    : role === "contributor"
      ? "You can add notes and suggestions."
      : "You can read notes and suggestions.";
  return <p className="note">{text}</p>;
}
