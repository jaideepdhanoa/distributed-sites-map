"use client";

import { useEffect, useState } from "react";
import { formatPacific } from "@/lib/actions/time";
import { MentionChips, MentionField, type MentionAccount } from "./MentionField";
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
  mentions?: MentionAccount[];
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
  ownerId: string | null;
  ownerName: string | null;
  doneAt: string | null;
  mentions?: MentionAccount[];
};
type Account = MentionAccount;

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

export function RecordActions({ kind, id, variant = "card" }: { kind: "site" | "deal"; id: string; variant?: "card" | "queue" }) {
  const status = useActionStatus();
  const [notes, setNotes] = useState<Note[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [note, setNote] = useState("");
  const [noteMentions, setNoteMentions] = useState<Account[]>([]);
  const [stepMentions, setStepMentions] = useState<Account[]>([]);
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
    window.dispatchEvent(new Event("queue-refresh"));
  }

  function openThread(sourceId: string) {
    void fetch("/api/queue/mentions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceId }),
    }).then(() => window.dispatchEvent(new Event("queue-refresh"))).catch(() => undefined);
  }

  function canFinish(item: Suggestion) {
    return item.field === "proposed_next_step" && !item.doneAt && (item.status === "open" || item.status === "accepted") && (reviewer || item.ownerId === status.username);
  }

  const approvedSteps = suggestions
    .filter((item) => item.field === "proposed_next_step" && item.status === "accepted")
    .sort((a, b) => (b.decidedAt || "").localeCompare(a.decidedAt || ""));
  const currentStep = approvedSteps[0];
  const roots = notes.filter((item) => !item.parentId);
  const pendingSteps = suggestions.filter((item) => item.field === "proposed_next_step" && item.status === "open");

  const threads = roots.length ? (
    <div className="act-threads" data-testid="note-threads">
      {roots.map((item) => (
        <NoteThread
          key={item.id}
          note={item}
          replies={notes.filter((reply) => reply.parentId === item.id)}
          writable={writable}
          reviewer={reviewer}
          pending={pending}
          accounts={accounts}
          onOpen={openThread}
          onReply={(parentId, body, mentions) => submit("/api/actions/notes", { targetKind: kind, targetId: id, parentId, body, mentions }, () => undefined)}
          onEdit={(noteId, body, mentions) => submit(`/api/actions/notes/${noteId}`, { body, mentions }, () => undefined, "PATCH")}
          onDelete={(noteId) => submit(`/api/actions/notes/${noteId}`, null, () => undefined, "DELETE")}
          onResolve={(noteId) => submit(`/api/actions/notes/${noteId}/resolve`, {}, () => undefined)}
          actor={status.username}
        />
      ))}
    </div>
  ) : (
    <p className="note">No notes yet.</p>
  );

  const noteForm = writable ? (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit("/api/actions/notes", { targetKind: kind, targetId: id, body: note, mentions: noteMentions.map((item) => item.id) }, () => {
          setNote("");
          setNoteMentions([]);
        });
      }}
    >
      <MentionField
        label="Note"
        value={note}
        onChange={setNote}
        mentions={noteMentions}
        onMentions={setNoteMentions}
        accounts={accounts}
        testId="note-body"
        rows={variant === "queue" ? 2 : 3}
        maxLength={2000}
      />
      <button type="submit" disabled={pending}>Save note</button>
    </form>
  ) : (
    <p className="note">Notes are read only for this login.</p>
  );

  const proposeForm = writable ? (
    <form
      data-testid="next-step-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(
          "/api/actions/suggestions",
          { targetKind: kind, targetId: id, field: "proposed_next_step", title: stepTitle, targetOn: stepDate, ownerId: stepOwner, proposedValue: stepTitle, mentions: stepMentions.map((item) => item.id) },
          () => {
            setStepTitle("");
            setStepDate("");
            setStepOwner("");
            setStepMentions([]);
          },
        );
      }}
    >
      <h3>Propose a next step</h3>
      <MentionField
        label="Title"
        value={stepTitle}
        onChange={setStepTitle}
        mentions={stepMentions}
        onMentions={setStepMentions}
        accounts={accounts}
        testId="next-step-title"
        maxLength={120}
      />
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
  ) : null;

  if (variant === "queue") {
    const steps = [
      ...(currentStep ? [currentStep] : []),
      ...pendingSteps,
    ];
    return (
      <section className="act" data-testid="record-actions">
        <h3>Notes</h3>
        {threads}
        {noteForm}
        <div data-testid="next-step">
          <h3>Next step</h3>
          {steps.length ? (
            <ul className="act-list" data-testid="queue-assignments">
              {steps.map((item) => (
                <li key={item.id}>
                  <p>
                    <strong>{item.title || item.proposedValue}</strong>
                    {item.targetOn ? ` · ${item.targetOn}` : ""}
                    {item.ownerName ? ` · ${item.ownerName}` : ""}
                    {" "}
                    <span className={`badge ${item.status === "open" ? "pending" : "checked"}`}>{item.status === "accepted" ? "Approved" : "Open"}</span>
                  </p>
                  <MentionChips mentions={item.mentions} />
                  <div className="act-row">
                    {canFinish(item) ? (
                      <button type="button" data-testid="next-step-done" onClick={() => void submit(`/api/actions/suggestions/${item.id}/done`, {}, () => undefined)}>Done</button>
                    ) : null}
                    {reviewer && item.status === "open" ? (
                      <>
                        <button type="button" onClick={() => void submit(`/api/actions/suggestions/${item.id}`, { status: "accepted" }, () => undefined)}>Accept</button>
                        <button type="button" onClick={() => void submit(`/api/actions/suggestions/${item.id}`, { status: "rejected" }, () => undefined)}>Reject</button>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="note">No approved next step.</p>
          )}
          {proposeForm}
        </div>
        {error ? <p className="err" role="alert" data-testid="action-error">{error}</p> : null}
      </section>
    );
  }

  return (
    <section className="act" data-testid="record-actions">
      <div className="act-threads" data-testid="note-threads">
        {roots.map((item) => (
          <NoteThread
            key={item.id}
            note={item}
            replies={notes.filter((reply) => reply.parentId === item.id)}
            writable={writable}
            reviewer={reviewer}
            pending={pending}
            accounts={accounts}
            onOpen={openThread}
            onReply={(parentId, body, mentions) => submit("/api/actions/notes", { targetKind: kind, targetId: id, parentId, body, mentions }, () => undefined)}
            onEdit={(noteId, body, mentions) => submit(`/api/actions/notes/${noteId}`, { body, mentions }, () => undefined, "PATCH")}
            onDelete={(noteId) => submit(`/api/actions/notes/${noteId}`, null, () => undefined, "DELETE")}
            onResolve={(noteId) => submit(`/api/actions/notes/${noteId}/resolve`, {}, () => undefined)}
            actor={status.username}
          />
        ))}
      </div>
      {writable ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit("/api/actions/notes", { targetKind: kind, targetId: id, body: note, mentions: noteMentions.map((item) => item.id) }, () => {
              setNote("");
              setNoteMentions([]);
            });
          }}
        >
          <MentionField
            label=""
            placeholder="Comment or @mention…"
            value={note}
            onChange={setNote}
            mentions={noteMentions}
            onMentions={setNoteMentions}
            accounts={accounts}
            testId="note-body"
            rows={3}
            maxLength={2000}
          />
          <p className="hint">Type @ to mention someone.</p>
          <div className="act-row">
            <button type="submit" disabled={pending}>Comment</button>
          </div>
        </form>
      ) : (
        <p className="note">Notes are read only for this login.</p>
      )}
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
  accounts,
  onReply,
  onEdit,
  onDelete,
  onResolve,
  onOpen,
}: {
  note: Note;
  replies: Note[];
  writable: boolean;
  reviewer: boolean;
  pending: boolean;
  actor: string;
  accounts: Account[];
  onReply: (parentId: string, body: string, mentions: string[]) => void;
  onEdit: (id: string, body: string, mentions: string[]) => void;
  onDelete: (id: string) => void;
  onResolve: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const [reply, setReply] = useState("");
  const [replying, setReplying] = useState(false);
  const [replyMentions, setReplyMentions] = useState<Account[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [draftMentions, setDraftMentions] = useState<Account[]>(note.mentions || []);
  const [confirming, setConfirming] = useState(false);
  const mentionedMe = [note, ...replies].some((item) => item.mentions?.some((mention) => mention.id === actor));
  return (
    <details
      className="act-thread"
      open={!note.resolvedAt && !mentionedMe}
      data-testid="note-thread"
      onToggle={(event) => { if (event.currentTarget.open) onOpen(note.id); }}
    >
      <summary>
        <strong>{accounts.find((account) => account.id === note.authorId)?.name || note.authorId}</strong> · {formatPacific(note.createdAt)}
      </summary>
      {note.deleted ? <p className="note">Removed</p> : editing ? (
        <form onSubmit={(event) => { event.preventDefault(); onEdit(note.id, draft, draftMentions.map((item) => item.id)); setEditing(false); }}>
          <MentionField label="Edit note" value={draft} onChange={setDraft} mentions={draftMentions} onMentions={setDraftMentions} accounts={accounts} testId={`edit-${note.id}`} rows={3} maxLength={2000} />
          <button type="submit" disabled={pending}>Save edit</button>
        </form>
      ) : (
        <>
          <p>
            {note.body}
            {note.updatedAt ? <span className="note"> · edited</span> : null}
          </p>
          {note.mentions?.length ? <p className="note">Mentioned <MentionChips mentions={note.mentions} /></p> : null}
        </>
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
            <ReplyLine key={replyNote.id} note={replyNote} actor={actor} accounts={accounts} writable={writable} pending={pending} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </ul>
      ) : null}
      {writable && !note.deleted ? (
        replying ? (
          <form onSubmit={(event) => { event.preventDefault(); onReply(note.id, reply, replyMentions.map((item) => item.id)); setReply(""); setReplyMentions([]); setReplying(false); }}>
            <MentionField label="Reply" value={reply} onChange={setReply} mentions={replyMentions} onMentions={setReplyMentions} accounts={accounts} testId="note-reply" rows={2} maxLength={2000} />
            <button type="submit" disabled={pending}>Reply</button>
          </form>
        ) : (
          <button type="button" onClick={() => setReplying(true)}>Reply</button>
        )
      ) : null}
    </details>
  );
}

function ReplyLine({
  note,
  actor,
  accounts,
  writable,
  pending,
  onEdit,
  onDelete,
}: {
  note: Note;
  actor: string;
  accounts: Account[];
  writable: boolean;
  pending: boolean;
  onEdit: (id: string, body: string, mentions: string[]) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [draftMentions, setDraftMentions] = useState<Account[]>(note.mentions || []);
  const [confirming, setConfirming] = useState(false);
  return (
    <li>
      {note.deleted ? <p className="note">Removed</p> : editing ? (
        <form onSubmit={(event) => { event.preventDefault(); onEdit(note.id, draft, draftMentions.map((item) => item.id)); setEditing(false); }}>
          <MentionField label="Edit reply" value={draft} onChange={setDraft} mentions={draftMentions} onMentions={setDraftMentions} accounts={accounts} testId={`edit-${note.id}`} rows={2} maxLength={2000} />
          <button type="submit" disabled={pending}>Save edit</button>
        </form>
      ) : (
        <>
          <p>{note.body}</p>
          {note.mentions?.length ? <p className="note">Mentioned <MentionChips mentions={note.mentions} /></p> : null}
        </>
      )}
      <p className="note"><strong>{accounts.find((account) => account.id === note.authorId)?.name || note.authorId}</strong> · {formatPacific(note.createdAt)}{note.updatedAt ? " · edited" : ""}</p>
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
