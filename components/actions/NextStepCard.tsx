"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { canCloseProposal } from "@/lib/actions/proposalAccess";
import { suggestedDropProposal } from "@/lib/actions/nextStep";
import { allowsAssignee, allowsDate, droppedStage, emptyNextStepActions, forwardStageId, NEXT_STEP_TYPES, nextStageChoices, nextStepType, nextStepTypeLabel, showCardBringBack, stageMoveLabel, type NextStepTypeId } from "@/lib/actions/nextStepTypes";
import { stripGmailIds } from "@/lib/displayText";
import { plainNextStep } from "@/lib/nextStepLine";
import { stageTitle } from "@/lib/labels";
import { contactDate } from "@/lib/cardStatus";
import type { WorkbookStep } from "@/lib/workbookStep";
import type { DealProps } from "@/lib/types";
import { blockerSentenceForDeal } from "@/lib/nda";
import { pacificToday } from "@/lib/queue/today";
import { BlockerLine } from "../NdaChip";
import { ReasonPicker } from "../ReasonPicker";
import { TagChip } from "../TagChip";
import type { TagView } from "@/lib/tags/map";
import { tagFamily } from "@/lib/tags/vocab";
import NoteBody from "../NoteBody";
import { suggestedDropPhrase } from "@/lib/suggestedDropLine";
import { approvedStage, publishStageRefresh, refreshFromSuggestion } from "@/lib/stageOverlay";
import { quietActionsFetch } from "@/lib/actions/quiet";
import { formatPacific } from "@/lib/actions/time";
import { SuggestedBlock } from "../agent/SuggestedBlock";
import { useRecommendations } from "../agent/useRecommendations";
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
  stale?: boolean;
  currentStage?: string | null;
  blockers?: { id: string; kind: string; label: string; party: string; askedOn: string | null; followUpOn: string | null; closed: boolean }[];
};
type Need = { kind: string; label: string; party: string; askedOn: string | null; followUpOn: string | null };
type ProposalNote = { id: string; body: string; authorId: string; createdAt: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Survives a card remount when the map applies the new stage in the same page. */
const rememberedStage = new Map<string, Step>();

function stageKey(kind: string, id: string) {
  return `${kind}:${id}`;
}

function rememberStage(kind: string, id: string, suggestion: Step) {
  if (suggestion.status !== "accepted" || !approvedStage(suggestion)) return;
  rememberedStage.set(stageKey(kind, id), suggestion);
}

function mergeSteps(kind: string, id: string, incoming: Step[]): Step[] {
  const key = stageKey(kind, id);
  const saved = rememberedStage.get(key);
  if (!saved) return incoming;
  const fromServer = incoming.find((item) => item.id === saved.id);
  if (!fromServer) return [saved, ...incoming.filter((item) => item.id !== saved.id)];
  if (fromServer.status === "applied" || fromServer.status === "rejected" || fromServer.doneAt) {
    rememberedStage.delete(key);
    return incoming;
  }
  if (saved.status === "accepted" && fromServer.status !== "accepted") {
    return incoming.map((item) => (item.id === saved.id ? saved : item));
  }
  rememberedStage.set(key, fromServer);
  return incoming;
}

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

function sameIdea(title: string, kind: string) {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/^next /, "").trim();
  const left = normalize(title);
  const right = normalize(kind);
  if (!left || !right) return true;
  if (left === right || left.startsWith(right) || right.startsWith(left)) return true;
  const leftWords = left.split(" ");
  const rightWords = right.split(" ");
  let shared = 0;
  while (shared < leftWords.length && shared < rightWords.length && leftWords[shared] === rightWords[shared]) shared += 1;
  return shared >= 3;
}

function statusMark(status: string) {
  if (status === "ready") return { label: "Ready for approval", tone: "pending" };
  if (status === "agreed_waiting") return { label: "Agreed, waiting", tone: "held" };
  return { label: "Awaiting approval", tone: "pending" };
}

export function NextStepCard({
  kind,
  id,
  stageGroup,
  stage: recordStage,
  signedIn = false,
  workbookId = "",
  suggestedDrop,
  blocker,
  chips,
  waitingShown = false,
}: {
  kind: "site" | "deal";
  id: string;
  stageGroup?: string | null;
  stage?: string | null;
  signedIn?: boolean;
  workbookId?: string;
  suggestedDrop?: string | null;
  blocker?: (Pick<DealProps, "stage" | "stage_group"> & Partial<Pick<DealProps, "stage_blocker" | "stage_blocker_since">>) | null;
  chips?: TagView[];
  /** The decision row already shows the waiting chip. */
  waitingShown?: boolean;
}) {
  const params = useSearchParams();
  const proposal = params.get("panel") === "proposal";
  const reviewing = params.get("review") === "1" || params.get("view") === "review";
  const cardRef = useRef<HTMLElement>(null);
  const status = useActionStatus();
  const [steps, setSteps] = useState<Step[]>(() => {
    const saved = rememberedStage.get(stageKey(kind, id));
    return saved ? [saved] : [];
  });
  const loadGen = useRef(0);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [type, setType] = useState<NextStepTypeId | "">("");
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [stage, setStage] = useState("");
  const [survivor, setSurvivor] = useState("");
  const [sameParcel, setSameParcel] = useState(false);
  const [ownerId, setOwnerId] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState("");
  const lastCreate = useRef({ draft: "", key: "" });
  const [pending, setPending] = useState(false);
  const [dropHidden, setDropHidden] = useState(false);
  const dropKey = `sites-drop-hide:${kind}:${id}`;
  const [closeReason, setCloseReason] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [decisionRecommendationId, setDecisionRecommendationId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState("accepted");
  const [holdLabel, setHoldLabel] = useState("");
  const [holdParty, setHoldParty] = useState("");
  const [holdAsked, setHoldAsked] = useState("");
  const [holdFollow, setHoldFollow] = useState("");
  const [needs, setNeeds] = useState<Need[]>([]);
  const [proposalNotes, setProposalNotes] = useState<ProposalNote[]>([]);
  const siteRecommendations = useRecommendations(id);
  const [reassigning, setReassigning] = useState(false);
  const [dating, setDating] = useState(false);
  const writable = canWrite(status.actionRole);
  const reviewer = canReview(status.actionRole);
  const stages = nextStageChoices();
  const forward = forwardStageId(stageGroup, recordStage);
  const moveLabel = stageMoveLabel(stageGroup, recordStage);
  const forwardRef = useRef(forward);
  forwardRef.current = forward;
  const [workbook, setWorkbook] = useState<WorkbookStep | null>(null);
  const lookup = workbookId || (kind === "deal" ? id : "");

  async function reload() {
    const token = ++loadGen.current;
    const query = new URLSearchParams({ targetKind: kind, targetId: id });
    const response = await quietActionsFetch(`/api/actions/suggestions?${query}`);
    if (!response.ok || token !== loadGen.current) return;
    const body = (await response.json()) as { suggestions?: Step[]; needs?: Need[] };
    setSteps(mergeSteps(kind, id, (body.suggestions || []).filter((item) => item.field === "proposed_next_step")));
    setNeeds(body.needs || []);
  }

  useEffect(() => {
    function onOpen(event: Event) {
      const detail = (event as CustomEvent<NextStepTypeId>).detail;
      if (!detail) return;
      setType(detail);
      if (detail === "stage_move") setStage(forwardRef.current);
      setOpen(true);
    }
    function onPrefill(event: Event) {
      const detail = (event as CustomEvent<{ title?: string; targetId?: string; reason?: string }>).detail;
      if (detail?.targetId && detail.targetId !== id) return;
      setEditing(null);
      setReason(detail?.reason || "");
      setOwnerId("");
      setDue("");
      setError("");
      setType("work_item");
      setOpen(true);
      setTitle((detail?.title || "").slice(0, 120));
      requestAnimationFrame(() => {
        const form = cardRef.current?.querySelector("form");
        form?.scrollIntoView({ block: "center" });
        form?.querySelector<HTMLElement>('[aria-label="Title"], input:not([type=date]), textarea')?.focus({ preventScroll: true });
      });
    }
    window.addEventListener("sites-open-next-step", onOpen);
    window.addEventListener("sites-prefill-work-item", onPrefill);
    return () => {
      window.removeEventListener("sites-open-next-step", onOpen);
      window.removeEventListener("sites-prefill-work-item", onPrefill);
    };
  }, [id]);

  useEffect(() => {
    const phone = window.matchMedia("(max-width: 767px)").matches;
    if ((!proposal && !(reviewing && phone)) || !status.enabled) return;
    const node = cardRef.current;
    const scroller = node?.closest(".drawer-scroll");
    if (!node || !(scroller instanceof HTMLElement)) return;
    let frame = 0;
    const align = () => {
      const top = node.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const next = Math.max(0, top - 4);
      if (Math.abs(scroller.scrollTop - next) > 2) scroller.scrollTo({ top: next });
    };
    const sizes = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(align);
    });
    sizes.observe(scroller);
    for (const child of scroller.children) sizes.observe(child);
    align();
    const stop = window.setTimeout(() => sizes.disconnect(), 8000);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(stop);
      sizes.disconnect();
    };
  }, [proposal, reviewing, status.enabled, id]);

  useEffect(() => {
    if (!signedIn || !lookup) {
      setWorkbook(null);
      return undefined;
    }
    let cancel = false;
    fetch(`/api/data/financials/${encodeURIComponent(lookup)}`)
      .then(async (response) => (response.ok ? await response.json() as { workbookStep?: WorkbookStep | null } : null))
      .then((body) => {
        if (cancel) return;
        const step = body?.workbookStep;
        setWorkbook(step && (step.text || step.owner || step.due) ? step : null);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [signedIn, lookup]);

  useEffect(() => {
    if (!status.enabled) return undefined;
    let cancel = false;
    const query = new URLSearchParams({ targetKind: kind, targetId: id });
    const token = ++loadGen.current;
    Promise.all([quietActionsFetch(`/api/actions/suggestions?${query}`), quietActionsFetch("/api/actions/accounts")]).then(async ([stepsRes, accountsRes]) => {
      if (cancel || token !== loadGen.current) return;
      if (stepsRes.ok) {
        const body = (await stepsRes.json()) as { suggestions?: Step[]; needs?: Need[] };
        setSteps(mergeSteps(kind, id, (body.suggestions || []).filter((item) => item.field === "proposed_next_step")));
        setNeeds(body.needs || []);
      }
      if (accountsRes.ok) setAccounts(((await accountsRes.json()) as { accounts: Account[] }).accounts || []);
    }).catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [status.enabled, kind, id]);

  const pendingSteps = steps.filter((item) => item.status === "open" && !item.doneAt);
  const readySteps = steps.filter((item) => item.status === "ready" && !item.doneAt);
  const waitingSteps = steps.filter((item) => item.status === "agreed_waiting" && !item.doneAt);
  const focus = readySteps[0] || pendingSteps[0] || waitingSteps[0] || null;

  useEffect(() => {
    if (!focus) return;
    if (focus.status === "ready") setOutcome("accepted");
    else if (focus.status === "agreed_waiting") setOutcome("reply");
    else if (nextStepType(focus.detail) === "stage_move") setOutcome("agreed_waiting");
    else setOutcome("accepted");
    setCloseReason("");
    const stageDecision = nextStepType(focus.detail) === "knock_off" || nextStepType(focus.detail) === "stage_move" || nextStepType(focus.detail) === "bring_back";
    setDecisionNote(stageDecision ? focus.reason || "" : "");
    setDecisionRecommendationId(null);
    setHoldLabel("");
    setHoldParty("");
    setHoldAsked("");
    setHoldFollow("");
  }, [focus?.id, focus?.status]);

  useEffect(() => {
    if (!status.enabled || !focus) return undefined;
    let cancel = false;
    const query = new URLSearchParams({ targetKind: "suggestion", targetId: focus.id });
    fetch(`/api/actions/notes?${query}`).then(async (response) => {
      if (cancel || !response.ok) return;
      const body = (await response.json()) as { notes?: ProposalNote[] };
      setProposalNotes(body.notes || []);
    }).catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [status.enabled, focus?.id, steps]);

  useEffect(() => {
    if (!status.enabled || !reviewer || open || !focus) return;
    if (!proposal && !reviewing) return;
    if (!window.matchMedia("(max-width: 767px)").matches) return;
    window.dispatchEvent(new CustomEvent("sites-sheet-snap", { detail: "full" }));
  }, [status.enabled, reviewer, open, focus, proposal, reviewing]);

  useEffect(() => {
    try {
      setDropHidden(sessionStorage.getItem(dropKey) === "1");
    } catch {
      setDropHidden(false);
    }
  }, [dropKey]);

  const workbookDue = workbook?.due ? contactDate(workbook.due) : "";
  const workbookBlock = signedIn && workbook ? <WorkbookLine text={workbook.text} owner={workbook.owner} due={workbookDue} /> : null;
  const nextAction = chips?.find((chip) => chip.family === "next_action");
  const dropPhrase = suggestedDropPhrase(suggestedDrop || "");
  const dropProposed = steps.some((item) => nextStepType(item.detail) === "knock_off" && !item.doneAt && item.status !== "rejected" && item.status !== "overtaken");
  const showDrop = Boolean(dropPhrase) && !droppedStage(stageGroup, recordStage) && !dropHidden && !dropProposed;
  const context = (
    <>
      {nextAction ? <TagChip chip={nextAction} compact={Boolean(workbook?.text)} /> : null}
      {waitingShown || workbook?.text || !blocker ? null : <BlockerLine deal={blocker} />}
    </>
  );
  if (!status.enabled) {
    const blocked = blocker ? blockerSentenceForDeal(blocker, pacificToday()) : "";
    if (!workbookBlock && !showDrop && !blocked && !nextAction) return null;
    return (
      <section className="next-card" data-testid="next-step">
        {showDrop ? <div className="suggested-row" data-testid="suggested-drop"><p>{dropPhrase}</p></div> : null}
        {workbookBlock}
        {context}
      </section>
    );
  }

  const approved = steps
    .filter((item) => item.status === "accepted" && !item.doneAt)
    .sort((a, b) => (b.decidedAt || "").localeCompare(a.decidedAt || ""))[0];

  function resetForm() {
    setOpen(false);
    setEditing(null);
    setType("");
    setTitle("");
    setReason("");
    setReasonCode("");
    setStage("");
    setSurvivor("");
    setSameParcel(false);
    setOwnerId("");
    setDue("");
    setReassigning(false);
    setDating(false);
    setCloseReason("");
  }

  async function submit(path: string, body: unknown, method = "POST") {
    setPending(true);
    setError("");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (path === "/api/actions/suggestions" && method === "POST") {
      const draft = JSON.stringify(body);
      if (lastCreate.current.draft !== draft) lastCreate.current = { draft, key: crypto.randomUUID() };
      headers["Idempotency-Key"] = lastCreate.current.key;
    }
    let response: Response;
    try {
      response = await fetch(path, { method, headers, body: JSON.stringify(body) });
    } catch {
      setPending(false);
      setError("Save could not be confirmed. Your draft is here. Check the refreshed record before submitting again.");
      await reload();
      return;
    }
    const payload = (await response.json().catch(() => ({}))) as { error?: string; suggestion?: Step };
    setPending(false);
    if (!response.ok) {
      setError(payload.error || "That could not be saved.");
      return;
    }
    lastCreate.current = { draft: "", key: "" };
    const saved = payload.suggestion;
    const refresh = saved ? refreshFromSuggestion(kind, id, saved) : null;
    if (saved && refresh) {
      rememberStage(kind, id, saved);
      setSteps((current) => mergeSteps(kind, id, [saved, ...current.filter((item) => item.id !== saved.id)]));
      const stageChange = approvedStage(saved);
      const actor = accounts.find((account) => account.id === status.username)?.name || status.username;
      publishStageRefresh(stageChange ? { ...refresh, note: `Moved to ${stageChange.label} by ${actor}, waiting for workbook` } : refresh);
    }
    resetForm();
    await reload();
    window.dispatchEvent(new Event("queue-refresh"));
  }

  function dismissDrop() {
    setDropHidden(true);
    try {
      sessionStorage.setItem(dropKey, "1");
    } catch {
      // The line stays hidden for this view.
    }
  }

  function acceptDrop() {
    const proposal = suggestedDropProposal(suggestedDrop || "");
    if (!proposal.reason || !writable) return;
    void submit("/api/actions/suggestions", { targetKind: kind, targetId: id, ...proposal });
  }

  function startEdit(item: Step) {
    const stepType = nextStepType(item.detail);
    setEditing(item.id);
    setOpen(true);
    setType(item.detail ? stepType : "work_item");
    setTitle(item.title || "");
    setReason(item.reason || "");
    setReasonCode(tagFamily(item.detail === "knock_off" ? "drop_reason" : "advance_reason")?.codes.find((code) => item.reason === code.label)?.code || "");
    setStage(item.detail === "bring_back" || item.detail === "stage_move" ? item.proposedValue : "");
    setSurvivor(item.detail === "mark_duplicate" ? item.proposedValue : "");
    setSameParcel(item.detail === "mark_duplicate");
    setOwnerId(item.ownerId || "");
    setDue(item.targetOn || "");
  }

  function reasonLabel(family: "drop_reason" | "advance_reason") {
    return tagFamily(family)?.codes.find((item) => item.code === reasonCode)?.label || "";
  }

  function payloadFor(stepType: NextStepTypeId) {
    const picked = stepType === "knock_off" ? reasonLabel("drop_reason") : stepType === "stage_move" ? reasonLabel("advance_reason") : "";
    return {
      targetKind: kind,
      targetId: id,
      field: "proposed_next_step",
      detail: stepType,
      title: stepType === "work_item" ? title : stepType === "knock_off" ? reason.trim() : undefined,
      proposedValue: stepType === "bring_back" || stepType === "stage_move" ? stage : stepType === "mark_duplicate" ? survivor : title,
      reason: picked || (stepType === "mark_duplicate" || stepType === "bring_back" || stepType === "work_item" ? reason : ""),
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
      <h3>Propose next step</h3>
      <div className="type-chips" role="group" aria-label="Next step type">
        {NEXT_STEP_TYPES.map((item) => (
          <button key={item.id} type="button" className={type === item.id ? "chip on" : "chip"} onClick={() => { setType(item.id); if (item.id === "stage_move" && !stage) setStage(forward); }}>{item.id === "stage_move" ? moveLabel : item.label}</button>
        ))}
      </div>
      {type === "work_item" ? (
        <label>
          Title
          <input className="field" aria-label="Title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} />
        </label>
      ) : null}
      {type === "knock_off" ? (
        <>
          <ReasonPicker label="Drop reason" testId="drop-reason" options={tagFamily("drop_reason")?.codes || []} value={reasonCode} onChange={setReasonCode} />
          <label>
            Note
            <textarea className="field" aria-label="Note" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={400} />
          </label>
        </>
      ) : null}
      {type === "mark_duplicate" || type === "bring_back" ? (
        <label>
          Reason
          <textarea className="field" aria-label="Reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={2000} required />
        </label>
      ) : null}
      {type === "mark_duplicate" ? (
        <>
          <label>
            Surviving record
            <input className="field" aria-label="Surviving record" value={survivor} onChange={(event) => setSurvivor(event.target.value)} placeholder="Pipeline, land, or universe id" />
          </label>
          <label className="act-check">
            <input className="check" type="checkbox" checked={sameParcel} onChange={(event) => setSameParcel(event.target.checked)} />
            These are the same parcel
          </label>
          <p className="hint">The link waits for approval. Marking a duplicate does not change Stage.</p>
        </>
      ) : null}
      {type === "bring_back" || type === "stage_move" ? (
        <label>
          Stage
          <select aria-label="Stage" value={stage} onChange={(event) => setStage(event.target.value)} className="secondary">
            <option value="">Choose a stage</option>
            {stages.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
      ) : null}
      {type === "stage_move" ? (
        <>
          <ReasonPicker label="Advance reason" testId="advance-reason" options={tagFamily("advance_reason")?.codes || []} value={reasonCode} onChange={setReasonCode} />
          <NeedList items={needs} />
        </>
      ) : null}
      {type && allowsAssignee(type) ? (
        <div className="split">
          <label>
            Assignee (optional)
            <select aria-label="Assignee" value={ownerId} onChange={(event) => setOwnerId(event.target.value)} className="secondary">
              <option value="">No assignee</option>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
          </label>
          <label>
            Due (optional)
            <input className="field" aria-label="Due" type="date" value={due} onChange={(event) => setDue(event.target.value)} />
          </label>
        </div>
      ) : null}
      <div className="proposal-send">
        <button type="submit" disabled={pending || !type || (type === "mark_duplicate" && !sameParcel) || (type === "knock_off" && !reasonLabel("drop_reason")) || (type === "stage_move" && !reasonLabel("advance_reason")) || (type === "bring_back" && !reason.trim())} className="propose">Submit for approval</button>
        <button type="button" onClick={resetForm} className="text-link">Cancel</button>
      </div>
    </form>
  ) : null;

  let body = form;
  if (!open && focus) {
    const stepType = nextStepType(focus.detail);
    const knock = stepType === "knock_off";
    const mark = statusMark(focus.status);
    const headline = stripGmailIds(focus.title || focus.proposedValue);
    const kindLabel = stepType === "stage_move" ? `Move to ${stageTitle(focus.proposedValue)}` : nextStepTypeLabel(focus.detail);
    const canEdit = focus.status === "open" && (reviewer || (writable && focus.authorId === status.username));
    body = (
      <>
        <div className="proposal-head">
          <span className={`badge ${mark.tone}`}>{mark.label}</span>
          {canEdit ? <button type="button" onClick={() => startEdit(focus)} className="text-link">Edit</button> : null}
        </div>
        {sameIdea(headline, kindLabel) ? null : <p className="proposal-kind">{kindLabel}</p>}
        <p className="proposal-title">{headline}</p>
        <p className="proposal-meta">
          Proposed by {who(accounts, focus.authorId)} · {formatPacific(focus.createdAt)}
          {focus.ownerName ? ` · Assignee ${focus.ownerName}` : knock ? " · No assignee" : ""}
          {focus.targetOn ? ` · Due ${shortDate(focus.targetOn)}` : ""}
        </p>
        {(knock || stepType === "mark_duplicate" || stepType === "bring_back") && focus.reason ? (
          <p className="proposal-reason"><span>Reason</span>{stripGmailIds(focus.reason)}</p>
        ) : null}
        {focus.stale ? <p className="hint">The stage changed after this proposal{focus.currentStage ? ` (${focus.currentStage})` : ""}.</p> : null}
        {stepType === "stage_move" && focus.status === "open" ? <NeedList items={needs} /> : null}
        <BlockerList
          blockers={focus.blockers || []}
          onClear={reviewer ? (blockerId) => void submit(`/api/actions/suggestions/${focus.id}`, { clearBlockerId: blockerId }) : undefined}
        />
        {proposalNotes.length ? (
          <div className="proposal-notes">
            <h3>Replies</h3>
            <ul>
              {proposalNotes.map((note) => (
                <li key={note.id}>
                  <NoteBody text={note.body} />
                  <p className="proposal-meta">{who(accounts, note.authorId)} · {formatPacific(note.createdAt)}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {canCloseProposal({ actorId: status.username, ownerId: focus.ownerId, admin: reviewer }) ? (
          <form
            className="proposal-decide"
            data-testid="close-proposal"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(`/api/actions/suggestions/${focus.id}`, { status: "superseded", reason: closeReason });
            }}
          >
            <label>
              Reason
              <input className="field" aria-label="Close reason" value={closeReason} onChange={(event) => setCloseReason(event.target.value)} maxLength={200} required />
            </label>
            <div className="proposal-send">
              <button type="submit" className="paper-btn" disabled={pending || !closeReason.trim()}>Close</button>
            </div>
          </form>
        ) : null}
        {siteRecommendations.rows.filter((item) => (item.kind === "decision" || item.kind === "status_reply") && item.proposalId === focus.id).map((item) => (
          <SuggestedBlock
            key={item.id}
            item={item}
            onUse={(draft, recommendationId) => {
              setDecisionNote(draft);
              setDecisionRecommendationId(recommendationId);
              if (item.kind === "status_reply" || item.decision === "none") setOutcome("reply");
              else if (item.decision === "agree_waiting") setOutcome("agreed_waiting");
              else if (item.decision === "close_overtaken") setOutcome("overtaken");
              else if (item.decision === "approve") setOutcome("accepted");
              else if (item.decision === "reject") setOutcome("rejected");
            }}
            onDismiss={(recommendationId) => void siteRecommendations.dismiss(recommendationId)}
          />
        ))}
        {reviewer ? (
          <OutcomeForm
            outcome={outcome}
            onOutcome={setOutcome}
            reply={decisionNote}
            onReply={setDecisionNote}
            allowAccept={focus.status !== "agreed_waiting"}
            allowWaiting={focus.status === "open"}
            holdLabel={holdLabel}
            holdParty={holdParty}
            holdAsked={holdAsked}
            holdFollow={holdFollow}
            onHoldLabel={setHoldLabel}
            onHoldParty={setHoldParty}
            onHoldAsked={setHoldAsked}
            onHoldFollow={setHoldFollow}
            pending={pending}
            stageMove={stepType === "stage_move" || stepType === "bring_back"}
            acceptReason={stepType === "knock_off" || stepType === "stage_move" || stepType === "bring_back"}
            reasonRequired={stepType === "knock_off" || stepType === "bring_back"}
            needsCount={needs.length}
            onSend={() => {
              if (outcome === "reply") {
                void submit("/api/actions/notes", { targetKind: "suggestion", targetId: focus.id, body: decisionNote, recommendationId: decisionRecommendationId });
                return;
              }
              void submit(`/api/actions/suggestions/${focus.id}`, {
                status: outcome,
                reply: decisionNote,
                note: decisionNote,
                recommendationId: decisionRecommendationId,
                hold: outcome === "agreed_waiting" ? { label: holdLabel, party: holdParty, askedOn: holdAsked, followUpOn: holdFollow } : undefined,
              });
            }}
          />
        ) : null}
      </>
    );
  } else if (!open && approved) {
    const stepType = nextStepType(approved.detail);
    const headline = stripGmailIds(`Next: ${approved.title || approved.proposedValue}`);
    const kindLabel = stepType === "stage_move" ? `Move to ${stageTitle(approved.proposedValue)}` : nextStepTypeLabel(approved.detail);
    body = (
      <>
        <span className="badge checked">Approved</span>
        {sameIdea(headline, kindLabel) ? null : <p className="proposal-kind">{kindLabel}</p>}
        <p className="proposal-title">{headline}</p>
        <p className="proposal-meta">
          Approved by {who(accounts, approved.decidedBy) || "the approver"}
          {approved.decidedAt ? ` · ${formatPacific(approved.decidedAt)}` : ""}
        </p>
        <p className="step-assignment"><span>Owner <b>{approved.ownerName || who(accounts, approved.ownerId) || "Unassigned"}</b></span>{approved.targetOn && <span>Due <b>{shortDate(approved.targetOn)}</b></span>}</p>
        <div className="act-row">
          {reviewer || approved.ownerId === status.username ? (
            <button type="button" className="propose" data-testid="next-step-done" onClick={() => void submit(`/api/actions/suggestions/${approved.id}/done`, {})}>Mark done</button>
          ) : null}
          {allowsAssignee(approved.detail) && (reviewer || approved.ownerId === status.username) ? (
            <button type="button" onClick={() => { setReassigning((value) => !value); setDating(false); setOwnerId(approved.ownerId || ""); }} className="paper-btn">Reassign</button>
          ) : null}
          {allowsDate(approved.detail) && (reviewer || approved.ownerId === status.username) ? (
            <button type="button" onClick={() => { setDating((value) => !value); setReassigning(false); setDue(approved.targetOn || ""); }} className="paper-btn">Change date</button>
          ) : null}
        </div>
        {reassigning ? (
          <div className="act-row">
            <select aria-label="Assignee" value={ownerId} onChange={(event) => setOwnerId(event.target.value)} className="secondary">
              <option value="">No assignee</option>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
            <button type="button" onClick={() => void submit(`/api/actions/suggestions/${approved.id}`, { ownerId }, "PATCH")} className="paper-btn">Save assignee</button>
          </div>
        ) : null}
        {dating ? (
          <div className="act-row">
            <input className="field" aria-label="Due" type="date" value={due} onChange={(event) => setDue(event.target.value)} />
            <button type="button" onClick={() => void submit(`/api/actions/suggestions/${approved.id}`, { targetOn: due }, "PATCH")} className="paper-btn">Save date</button>
          </div>
        ) : null}
        {(() => {
          const stageChange = approvedStage({ field: "proposed_next_step", detail: approved.detail, proposedValue: approved.proposedValue });
          return stageChange ? <p className="hint">Moved to {stageChange.label}, waiting for workbook.</p> : null;
        })()}
        {stepType === "bring_back" && approved.reason ? <p className="proposal-reason"><span>Reason</span>{approved.reason}</p> : null}
      </>
    );
  } else if (!open) {
    body = (
      <>
        {workbookBlock}
        <div className="stage-actions" role="group" aria-label="Stage actions">
          <div className="decision-actions">
          {emptyNextStepActions(stageGroup, recordStage).map((item) => (
            <button
              key={item.id}
              type="button"
              data-testid={item.id === "bring_back" ? "bring-back-dropped" : `empty-step-${item.id}`}
              onClick={() => {
                setType(item.id);
                setStage(item.id === "stage_move" ? forward : "");
                setOpen(true);
              }}
              className={item.prominent ? "primary" : "paper-btn"}
            >
              {item.id === "stage_move" ? moveLabel : nextStepTypeLabel(item.id)}
            </button>
          ))}
          </div>
        </div>
      </>
    );
  }

  const tone = open ? "compose" : focus ? (nextStepType(focus.detail) === "knock_off" ? "knock" : "pending") : approved ? "approved" : "empty";
  const idle = !open && !focus && !approved;
  const bringBack = showCardBringBack({
    stageGroup,
    stage: recordStage,
    openProposal: Boolean(focus) && !open,
    composingBringBack: open && type === "bring_back",
    approvedDetail: approved?.detail,
  });
  return (
    <section ref={cardRef} className={`next-card ${tone}`} data-testid="next-step" data-panel={proposal ? "proposal" : undefined}>
      {showDrop ? (
        <div className="suggested-row" data-testid="suggested-drop">
          <p>{dropPhrase}</p>
          {writable ? (
            <div className="suggested-actions">
              <button type="button" className="paper-btn" data-testid="suggested-drop-accept" disabled={pending} onClick={acceptDrop}>Accept</button>
              <button type="button" className="paper-btn" data-testid="suggested-drop-dismiss" disabled={pending} onClick={dismissDrop}>Dismiss</button>
            </div>
          ) : null}
        </div>
      ) : null}
      {focus && !open ? <div data-testid="proposed-next-step">{body}</div> : body}
      {tone === "empty" ? null : workbookBlock}
      {context}
      {bringBack && !idle ? (
        <button type="button" className="paper-btn" data-testid="bring-back-dropped" onClick={() => { setType("bring_back"); setOpen(true); setReason(""); }}>Bring back</button>
      ) : null}
      {error ? <p className="err" role="alert" data-testid="action-error">{error}</p> : null}
    </section>
  );
}

function WorkbookLine({ text, owner, due }: { text: string; owner: string; due: string }) {
  const plain = plainNextStep(text);
  const [open, setOpen] = useState(false);

  const more = Boolean(plain.full && plain.full !== plain.line);
  if (!plain.line && !owner && !due) return null;
  return (
    <div className="workbook-step" data-testid="workbook-step" data-note={open ? "full" : "line"}>
      <h3>Next action</h3>
      {plain.line && !open ? <p className="next-line" title={plain.full}>{plain.line}</p> : null}
      {open ? <p className="next-full">{plain.full}</p> : null}
      <p className="step-assignment"><span>Owner <b>{owner || "Unassigned"}</b></span>{due && <span>Due <b>{due}</b></span>}</p>
      {more ? (
        <button type="button" className="text-link" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? "Hide full note" : "Show full note"}
        </button>
      ) : null}
    </div>
  );
}

function needDetail(item: { party?: string; askedOn?: string | null; followUpOn?: string | null }) {
  return [
    item.party ? `from ${item.party}` : "",
    item.askedOn ? `asked ${item.askedOn}` : "",
    item.followUpOn ? `follow up ${item.followUpOn}` : "",
  ].filter(Boolean).join(" · ");
}

function NeedList({ items }: { items: Need[] }) {
  return (
    <div className="proposal-needs">
      <h3>Still needed</h3>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={`${item.kind}-${item.label}-${item.askedOn || ""}`}>
              {item.label}
              {needDetail(item) ? <span className="hint">{needDetail(item)}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">Nothing is filed as still needed. Add an NDA or hold if that is what you are waiting on.</p>
      )}
    </div>
  );
}

function BlockerList({
  blockers,
  onClear,
}: {
  blockers: NonNullable<Step["blockers"]>;
  onClear?: (id: string) => void;
}) {
  if (!blockers.length) return null;
  return (
    <div className="proposal-needs">
      <h3>Open blockers</h3>
      <ul>
        {blockers.map((item) => (
          <li key={item.id}>
            {item.closed ? "Cleared: " : ""}{item.label}
            {needDetail(item) ? <span className="hint">{needDetail(item)}</span> : null}
            {onClear && item.kind === "hold" && !item.closed ? (
              <label className="act-check">
                <input className="check" type="checkbox" checked={false} onChange={() => onClear(item.id)} />
                Cleared
              </label>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function OutcomeForm({
  outcome,
  onOutcome,
  reply,
  onReply,
  allowAccept,
  allowWaiting,
  holdLabel,
  holdParty,
  holdAsked,
  holdFollow,
  onHoldLabel,
  onHoldParty,
  onHoldAsked,
  onHoldFollow,
  pending,
  stageMove,
  acceptReason,
  reasonRequired,
  needsCount,
  onSend,
}: {
  outcome: string;
  onOutcome: (value: string) => void;
  reply: string;
  onReply: (value: string) => void;
  allowAccept: boolean;
  allowWaiting: boolean;
  holdLabel: string;
  holdParty: string;
  holdAsked: string;
  holdFollow: string;
  onHoldLabel: (value: string) => void;
  onHoldParty: (value: string) => void;
  onHoldAsked: (value: string) => void;
  onHoldFollow: (value: string) => void;
  pending: boolean;
  stageMove: boolean;
  acceptReason: boolean;
  reasonRequired: boolean;
  needsCount: number;
  onSend: () => void;
}) {
  const [holdOpen, setHoldOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const replyNeeded = outcome === "reply" || outcome === "agreed_waiting" || outcome === "overtaken";
  const holdNeeded = outcome === "agreed_waiting" && needsCount === 0 && !holdLabel.trim();
  const holdOptional = outcome === "agreed_waiting" && needsCount > 0;
  const holdStarted = Boolean(holdLabel.trim() || holdParty.trim() || holdAsked || holdFollow);
  const showHold = outcome === "agreed_waiting" && (!holdOptional || holdOpen || holdStarted);
  const stageAccept = acceptReason && outcome === "accepted";
  const showReply = stageAccept || replyNeeded || noteOpen || Boolean(reply.trim());
  const reasonMissing = stageAccept && reasonRequired && !reply.trim();
  return (
    <form
      className="proposal-decide"
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      <label>
        Outcome
        <select className="secondary" aria-label="Outcome" value={outcome} onChange={(event) => onOutcome(event.target.value)}>
          {allowAccept ? <option value="accepted">Accept</option> : null}
          {allowWaiting ? <option value="agreed_waiting">Agreed, waiting on…</option> : null}
          <option value="rejected">Reject</option>
          <option value="overtaken">Closed, overtaken</option>
          <option value="reply">Reply only</option>
        </select>
      </label>
      {stageMove && outcome === "accepted" ? <p className="hint">The map updates now. The stage is stored in the database. The workbook mirror copies it. Do not edit the workbook.</p> : null}
      {outcome === "agreed_waiting" ? <p className="hint">The stage stays. This links the open blockers and replies to the proposer.</p> : null}
      {showReply ? (
        <label>
          {stageAccept ? "Reason" : "Reply"}
          <textarea className="field" aria-label={stageAccept ? "Reason" : "Reply to the proposer"} data-testid="decision-note" value={reply} onChange={(event) => onReply(event.target.value)} rows={2} maxLength={2000} required={replyNeeded || reasonMissing} />
        </label>
      ) : (
        <button type="button" className="text-link" aria-expanded="false" onClick={() => setNoteOpen(true)}>Add a note</button>
      )}
      {showHold ? (
        <div className="proposal-hold">
          <h3>Hold</h3>
          <label>
            Waiting on
            <input className="field" aria-label="Waiting on" value={holdLabel} onChange={(event) => onHoldLabel(event.target.value)} maxLength={200} placeholder="Signature, file, or a pause" />
          </label>
          <label>
            From
            <input className="field" aria-label="From" value={holdParty} onChange={(event) => onHoldParty(event.target.value)} maxLength={120} />
          </label>
          <div className="split">
            <label>
              Asked
              <input className="field" aria-label="Date asked" type="date" value={holdAsked} onChange={(event) => onHoldAsked(event.target.value)} />
            </label>
            <label>
              Next follow-up
              <input className="field" aria-label="Next follow-up" type="date" value={holdFollow} onChange={(event) => onHoldFollow(event.target.value)} />
            </label>
          </div>
          {holdOptional && !holdStarted ? (
            <button type="button" className="text-link" aria-expanded="true" onClick={() => setHoldOpen(false)}>Hide hold</button>
          ) : null}
        </div>
      ) : null}
      {holdOptional && !showHold ? (
        <button type="button" className="text-link" aria-expanded="false" onClick={() => setHoldOpen(true)}>Add a hold</button>
      ) : null}
      <div className="proposal-send">
        <button type="submit" className="propose" disabled={pending || holdNeeded || reasonMissing || (replyNeeded && !reply.trim())}>Send</button>
      </div>
    </form>
  );
}
