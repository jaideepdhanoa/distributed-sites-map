"use client";

import { useEffect, useState } from "react";
import { allowsAssignee, allowsDate, NEXT_STEP_TYPES, nextStageChoices, nextStepType, nextStepTypeLabel, type NextStepTypeId } from "@/lib/actions/nextStepTypes";
import { formatPacific } from "@/lib/actions/time";
import "./actions.css";
import { canReview, canWrite, useActionStatus } from "./panel";

type Account = { id: string; name: string };
type Step = {
  id: string;
  field: string;
  detail: string | null;
  proposedValue: string;
  reason: string;
  status: string;
  authorId: string;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  title: string | null;
  targetOn: string | null;
  ownerId: string | null;
  ownerName: string | null;
  doneAt: string | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(iso: string | null) {
  if (!iso) return "";
  const [, month, day] = iso.split("-");
  const name = MONTHS[Number(month) - 1];
  if (!name || !day) return iso;
  return `${name} ${Number(day)}`;
}

function who(accounts: Account[], id: string | null | undefined) {
  if (!id) return "";
  return accounts.find((account) => account.id === id)?.name || id;
}

export function NextStepCard({ kind, id }: { kind: "site" | "deal"; id: string }) {
  const status = useActionStatus();
  const [steps, setSteps] = useState<Step[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [type, setType] = useState<NextStepTypeId | "">("");
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [stage, setStage] = useState("");
  const [survivor, setSurvivor] = useState("");
  const [sameParcel, setSameParcel] = useState(false);
  const [ownerId, setOwnerId] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [dating, setDating] = useState(false);
  const writable = canWrite(status.actionRole);
  const reviewer = canReview(status.actionRole);
  const stages = nextStageChoices();

  async function reload() {
    const query = new URLSearchParams({ targetKind: kind, targetId: id });
    const response = await fetch(`/api/actions/suggestions?${query}`);
    if (!response.ok) return;
    const body = (await response.json()) as { suggestions?: Step[] };
    setSteps((body.suggestions || []).filter((item) => item.field === "proposed_next_step"));
  }

  useEffect(() => {
    function onOpen(event: Event) {
      const detail = (event as CustomEvent<NextStepTypeId>).detail;
      if (!detail) return;
      setType(detail);
      setOpen(true);
    }
    window.addEventListener("sites-open-next-step", onOpen);
    return () => window.removeEventListener("sites-open-next-step", onOpen);
  }, []);

  useEffect(() => {
    if (!status.enabled) return undefined;
    let cancel = false;
    const query = new URLSearchParams({ targetKind: kind, targetId: id });
    Promise.all([fetch(`/api/actions/suggestions?${query}`), fetch("/api/actions/accounts")]).then(async ([stepsRes, accountsRes]) => {
      if (cancel) return;
      if (stepsRes.ok) {
        const body = (await stepsRes.json()) as { suggestions?: Step[] };
        setSteps((body.suggestions || []).filter((item) => item.field === "proposed_next_step"));
      }
      if (accountsRes.ok) setAccounts(((await accountsRes.json()) as { accounts: Account[] }).accounts || []);
    }).catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [status.enabled, kind, id]);

  if (!status.enabled) return null;

  const pendingSteps = steps.filter((item) => item.status === "open" && !item.doneAt);
  const approved = steps
    .filter((item) => item.status === "accepted" && !item.doneAt)
    .sort((a, b) => (b.decidedAt || "").localeCompare(a.decidedAt || ""))[0];
  const focus = pendingSteps[0] || null;

  function resetForm() {
    setOpen(false);
    setEditing(null);
    setType("");
    setTitle("");
    setReason("");
    setStage("");
    setSurvivor("");
    setSameParcel(false);
    setOwnerId("");
    setDue("");
    setReassigning(false);
    setDating(false);
  }

  async function submit(path: string, body: unknown, method = "POST") {
    setPending(true);
    setError("");
    const response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    setPending(false);
    if (!response.ok) {
      setError(payload.error || "That could not be saved.");
      return;
    }
    resetForm();
    await reload();
    window.dispatchEvent(new Event("queue-refresh"));
  }

  function startEdit(item: Step) {
    const stepType = nextStepType(item.detail);
    setEditing(item.id);
    setOpen(true);
    setType(item.detail ? stepType : "work_item");
    setTitle(item.title || "");
    setReason(item.reason || "");
    setStage(item.detail === "bring_back" || item.detail === "stage_move" ? item.proposedValue : "");
    setSurvivor(item.detail === "mark_duplicate" ? item.proposedValue : "");
    setSameParcel(item.detail === "mark_duplicate");
    setOwnerId(item.ownerId || "");
    setDue(item.targetOn || "");
  }

  function payloadFor(stepType: NextStepTypeId) {
    return {
      targetKind: kind,
      targetId: id,
      field: "proposed_next_step",
      detail: stepType,
      title: stepType === "work_item" ? title : undefined,
      proposedValue: stepType === "bring_back" || stepType === "stage_move" ? stage : stepType === "mark_duplicate" ? survivor : title,
      reason: stepType === "knock_off" || stepType === "mark_duplicate" ? reason : "",
      ownerId: allowsAssignee(stepType) ? ownerId : "",
      targetOn: allowsDate(stepType) ? due : "",
    };
  }

  const form = open ? (
    <form
      data-testid="next-step-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!type) return;
        if (type === "mark_duplicate" && !sameParcel) return;
        const body = payloadFor(type);
        if (editing) {
          void submit(`/api/actions/suggestions/${editing}`, body, "PATCH");
          return;
        }
        void submit("/api/actions/suggestions", body);
      }}
    >
      <p className="kicker">Propose next step</p>
      <div className="type-chips" role="group" aria-label="Next step type">
        {NEXT_STEP_TYPES.map((item) => (
          <button key={item.id} type="button" className={type === item.id ? "on" : ""} onClick={() => setType(item.id)}>{item.label}</button>
        ))}
      </div>
      {type === "work_item" ? (
        <label>
          Title
          <input aria-label="Title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} />
        </label>
      ) : null}
      {type === "knock_off" || type === "mark_duplicate" ? (
        <label>
          Reason
          <textarea aria-label="Reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={2000} required />
        </label>
      ) : null}
      {type === "mark_duplicate" ? (
        <>
          <label>
            Surviving record
            <input aria-label="Surviving record" value={survivor} onChange={(event) => setSurvivor(event.target.value)} placeholder="Pipeline, land, or universe id" />
          </label>
          <label className="act-check">
            <input type="checkbox" checked={sameParcel} onChange={(event) => setSameParcel(event.target.checked)} />
            These are the same parcel
          </label>
          <p className="hint">The link waits for approval. It does not change Stage.</p>
        </>
      ) : null}
      {type === "bring_back" || type === "stage_move" ? (
        <label>
          Stage
          <select aria-label="Stage" value={stage} onChange={(event) => setStage(event.target.value)}>
            <option value="">Choose a stage</option>
            {stages.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
      ) : null}
      {type && allowsAssignee(type) ? (
        <div className="split">
          <label>
            Assignee (optional)
            <select aria-label="Assignee" value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
              <option value="">No assignee</option>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
          </label>
          <label>
            Due (optional)
            <input aria-label="Due" type="date" value={due} onChange={(event) => setDue(event.target.value)} />
          </label>
        </div>
      ) : null}
      <div className="act-row">
        <button type="submit" disabled={pending || !type || (type === "mark_duplicate" && !sameParcel) || (type === "knock_off" && !reason.trim())}>Submit for approval</button>
        <button type="button" onClick={resetForm}>Cancel</button>
      </div>
    </form>
  ) : null;

  let body = form;
  if (!open && focus) {
    const stepType = nextStepType(focus.detail);
    const knock = stepType === "knock_off";
    body = (
      <>
        <div className="chip-row">
          <span className="wait">Waiting for approval</span>
          <span className="type">{nextStepTypeLabel(focus.detail)}</span>
        </div>
        <h3>{focus.title || focus.proposedValue}</h3>
        <p className="who">
          Proposed by {who(accounts, focus.authorId)} · {formatPacific(focus.createdAt)}
          {focus.ownerName ? ` · Assignee ${focus.ownerName}` : knock ? " · No assignee" : ""}
          {focus.targetOn ? ` · Due ${shortDate(focus.targetOn)}` : ""}
        </p>
        {(knock || stepType === "mark_duplicate") && focus.reason ? <p className="reason"><strong>Reason:</strong> {focus.reason}</p> : null}
        {reviewer ? (
          <div className="act-row">
            <button type="button" className="propose" onClick={() => void submit(`/api/actions/suggestions/${focus.id}`, { status: "accepted" })}>Accept</button>
            <button type="button" onClick={() => void submit(`/api/actions/suggestions/${focus.id}`, { status: "rejected" })}>Reject</button>
            <button type="button" onClick={() => startEdit(focus)}>Edit</button>
          </div>
        ) : writable && focus.authorId === status.username ? (
          <button type="button" onClick={() => startEdit(focus)}>Edit</button>
        ) : null}
      </>
    );
  } else if (!open && approved) {
    const stepType = nextStepType(approved.detail);
    body = (
      <>
        <div className="chip-row">
          <span className="approved-kicker">Next step · Approved</span>
          <span className="type">{nextStepTypeLabel(approved.detail)}</span>
        </div>
        <h3>Next: {approved.title || approved.proposedValue}</h3>
        <p className="who">
          Approved by {who(accounts, approved.decidedBy) || "the approver"}
          {approved.decidedAt ? ` · ${formatPacific(approved.decidedAt)}` : ""}
          {approved.ownerName ? ` · Owner ${approved.ownerName}` : ""}
          {approved.targetOn ? ` · Due ${shortDate(approved.targetOn)}` : ""}
        </p>
        <div className="act-row">
          {reviewer || approved.ownerId === status.username ? (
            <button type="button" className="propose" data-testid="next-step-done" onClick={() => void submit(`/api/actions/suggestions/${approved.id}/done`, {})}>Mark done</button>
          ) : null}
          {allowsAssignee(approved.detail) && (reviewer || approved.ownerId === status.username) ? (
            <button type="button" onClick={() => { setReassigning((value) => !value); setDating(false); setOwnerId(approved.ownerId || ""); }}>Reassign</button>
          ) : null}
          {allowsDate(approved.detail) && (reviewer || approved.ownerId === status.username) ? (
            <button type="button" onClick={() => { setDating((value) => !value); setReassigning(false); setDue(approved.targetOn || ""); }}>Change date</button>
          ) : null}
        </div>
        {reassigning ? (
          <div className="act-row">
            <select aria-label="Assignee" value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
              <option value="">No assignee</option>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
            <button type="button" onClick={() => void submit(`/api/actions/suggestions/${approved.id}`, { ownerId }, "PATCH")}>Save assignee</button>
          </div>
        ) : null}
        {dating ? (
          <div className="act-row">
            <input aria-label="Due" type="date" value={due} onChange={(event) => setDue(event.target.value)} />
            <button type="button" onClick={() => void submit(`/api/actions/suggestions/${approved.id}`, { targetOn: due }, "PATCH")}>Save date</button>
          </div>
        ) : null}
        {stepType === "knock_off" ? <p className="hint">The workbook export asks for stage Dropped.</p> : null}
      </>
    );
  } else if (!open) {
    body = (
      <>
        <p className="kicker">Next step</p>
        <div className="type-chips" role="group" aria-label="Next step type">
          <button type="button" onClick={() => { setType("stage_move"); setOpen(true); }}>Advance</button>
          <button type="button" onClick={() => { setType("knock_off"); setOpen(true); }}>Drop with a reason</button>
          <button type="button" onClick={() => { setType("mark_duplicate"); setOpen(true); }}>Mark duplicate</button>
        </div>
        <p className="hint">Approval is required before it changes the record. Resolving a comment does not change Stage.</p>
      </>
    );
  }

  const tone = focus && !open ? (nextStepType(focus.detail) === "knock_off" ? "knock" : "pending") : approved && !open && !focus ? "approved" : "empty";
  return (
    <section className={`next-card ${tone}`} data-testid="next-step">
      {focus && !open ? <div data-testid="proposed-next-step">{body}</div> : body}
      {error ? <p className="err" role="alert" data-testid="action-error">{error}</p> : null}
    </section>
  );
}
