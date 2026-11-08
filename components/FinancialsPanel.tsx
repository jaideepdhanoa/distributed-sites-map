"use client";

import { useEffect, useState } from "react";
import { canReview, canWrite, useActionStatus } from "./actions/panel";
import {
  PERIODS,
  applyDecisions,
  checklistLabel,
  parseDocumentRequest,
  shownAmount,
  stateLine,
  type DocumentDecision,
  type FinancialPanel,
} from "@/lib/financials";

type Account = { id: string; name: string };

function decisionFromSuggestion(item: { status: string; proposedValue: string; ownerName: string | null; targetOn: string | null; decidedAt: string | null }): DocumentDecision | null {
  const parsed = parseDocumentRequest(item.proposedValue);
  if (!parsed) return null;
  const asked = (item.decidedAt || "").slice(0, 10);
  return {
    status: item.status as DocumentDecision["status"],
    mode: parsed.mode,
    items: parsed.items,
    owner: item.ownerName || "",
    askedOn: asked,
    reason: parsed.reason,
  };
}

export default function FinancialsPanel({
  dealId,
  initial,
  onClose,
}: {
  dealId: string;
  initial: FinancialPanel;
  onClose: () => void;
}) {
  const status = useActionStatus();
  const [panel, setPanel] = useState(initial);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>("Latest");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [owner, setOwner] = useState("");
  const [snooze, setSnooze] = useState("");
  const [reason, setReason] = useState("");
  const [wholePackage, setWholePackage] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [openRequests, setOpenRequests] = useState<{ id: string; proposedValue: string; ownerName: string | null }[]>([]);
  const writable = canWrite(status.actionRole);
  const reviewer = canReview(status.actionRole);

  useEffect(() => {
    setPanel(initial);
  }, [initial]);

  useEffect(() => {
    if (!status.enabled) return undefined;
    let cancel = false;
    const query = new URLSearchParams({ targetKind: "deal", targetId: dealId });
    Promise.all([fetch(`/api/actions/suggestions?${query}`), fetch("/api/actions/accounts")]).then(async ([suggestionsRes, accountsRes]) => {
      if (cancel) return;
      if (accountsRes.ok) setAccounts(((await accountsRes.json()) as { accounts: Account[] }).accounts || []);
      if (!suggestionsRes.ok) return;
      const body = (await suggestionsRes.json()) as { suggestions?: { id: string; field: string; status: string; proposedValue: string; ownerName: string | null; targetOn: string | null; decidedAt: string | null }[] };
      const rows = (body.suggestions || []).filter((item) => item.field === "document_request");
      setOpenRequests(rows.filter((item) => item.status === "open"));
      const decisions = rows.map(decisionFromSuggestion).filter((item): item is DocumentDecision => Boolean(item));
      setPanel(applyDecisions(initial, decisions));
    }).catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [status.enabled, dealId, initial]);

  const figures = panel.figures.filter((item) => item.period === period);
  const missing = panel.checklist.filter((item) => item.state !== "On file");

  async function submit(mode: "request" | "refused" | "package_refused") {
    if (mode !== "request" && !reason.trim()) {
      setError("Add the reason.");
      return;
    }
    setPending(true);
    setError("");
    const items = mode === "package_refused" ? [] : picked;
    const response = await fetch("/api/actions/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetKind: "deal",
        targetId: dealId,
        field: "document_request",
        proposedValue: JSON.stringify({ mode, items, reason: reason.trim() }),
        reason: reason.trim() || "Request documents",
        ownerId: owner,
        targetOn: snooze,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    setPending(false);
    if (!response.ok) {
      setError(payload.error || "That could not be saved.");
      return;
    }
    setPicked([]);
    setReason("");
    setSnooze("");
    setWholePackage(false);
    window.dispatchEvent(new Event("queue-refresh"));
    const query = new URLSearchParams({ targetKind: "deal", targetId: dealId });
    const listed = await fetch(`/api/actions/suggestions?${query}`);
    if (listed.ok) {
      const body = (await listed.json()) as { suggestions?: { id: string; field: string; status: string; proposedValue: string; ownerName: string | null; targetOn: string | null; decidedAt: string | null }[] };
      const rows = (body.suggestions || []).filter((item) => item.field === "document_request");
      setOpenRequests(rows.filter((item) => item.status === "open"));
      const decisions = rows.map(decisionFromSuggestion).filter((item): item is DocumentDecision => Boolean(item));
      setPanel(applyDecisions(initial, decisions));
    }
  }

  async function decide(id: string, next: "accepted" | "rejected") {
    setPending(true);
    setError("");
    const response = await fetch(`/api/actions/suggestions/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setPending(false);
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setError(payload.error || "That could not be saved.");
      return;
    }
    window.dispatchEvent(new Event("queue-refresh"));
    setOpenRequests((rows) => rows.filter((item) => item.id !== id));
    if (next === "accepted") {
      const match = openRequests.find((item) => item.id === id);
      const decision = match ? decisionFromSuggestion({ ...match, status: "accepted", targetOn: null, decidedAt: new Date().toISOString() }) : null;
      if (decision) setPanel((current) => applyDecisions(current, [decision]));
    }
  }

  return (
    <section className="fin-sheet" role="dialog" aria-label="Financials" data-testid="financials-panel">
      <header className="fin-head">
        <h3>Financials</h3>
        <button type="button" onClick={onClose}>Close</button>
      </header>
      <p className="fin-headline" data-testid="financials-headline">
        <strong>{shownAmount(panel.headline.text, "Not asked yet")}</strong>
        {panel.headline.metric ? <span>{panel.headline.metric}</span> : null}
        {panel.headline.claim ? <em>{panel.headline.claim}</em> : null}
      </p>
      {panel.packageLine ? <p>{panel.packageLine}{panel.packageHref ? <> · <a href={panel.packageHref} target="_blank" rel="noopener noreferrer">Open package</a></> : null}</p> : null}
      <div className="fin-switch" role="group" aria-label="Period">
        {PERIODS.map((item) => (
          <button key={item} type="button" className={item === period ? "on" : ""} onClick={() => setPeriod(item)}>{item}</button>
        ))}
      </div>
      <div className="fin-figures">
        {figures.map((item) => (
          <article key={`${item.figure}-${item.periodLabel}`}>
            <span>{item.figure}</span>
            <strong>{shownAmount(item.text, item.state, item.since, item.why)}</strong>
            <small>{item.periodLabel}</small>
            {item.claim ? <small>{item.claim}</small> : null}
            {item.sourceHref ? <a href={item.sourceHref} target="_blank" rel="noopener noreferrer">{item.sourceName || "Source file"}{item.page ? ` p. ${item.page}` : ""}</a> : item.sourceName ? <small>{item.sourceName}{item.page ? ` p. ${item.page}` : ""}</small> : null}
          </article>
        ))}
      </div>
      {panel.bridge.length || panel.ending ? (
        <div className="fin-bridge" data-testid="recast-bridge">
          <h3>Recast</h3>
          {panel.bridge.map((item) => (
            <p key={`${item.role}-${item.figure}`}>
              <span>{item.figure}</span>
              <strong>{shownAmount(item.text, "Not asked yet")}</strong>
              <small>{item.role}{item.counted ? "" : " · Not counted"}{item.page ? ` · p. ${item.page}` : ""}</small>
            </p>
          ))}
          {panel.ending ? (
            <p>
              <span>{panel.ending.figure}</span>
              <strong>{shownAmount(panel.ending.text, "Not asked yet")}</strong>
              <small>Normalized result</small>
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="fin-claims" data-testid="claims-actuals">
        <h3>Broker said, documents show</h3>
        {panel.claims.map((item) => (
          <p key={item.topic}>
            <span>{item.topic}</span>
            <small>Broker said {item.broker || stateLine("Not asked yet")}</small>
            <small>Documents show {item.documents || stateLine("Not asked yet")}</small>
          </p>
        ))}
      </div>
      <div className="fin-check" data-testid="package-checklist">
        <h3>Package checklist</h3>
        {panel.checklist.map((item) => (
          <article key={item.id}>
            <span>{checklistLabel(item.id)}</span>
            <strong>{stateLine(item.state, item.since, item.why)}</strong>
            {item.period ? <small>{item.period}</small> : null}
            {item.href ? <a href={item.href} target="_blank" rel="noopener noreferrer">Open file</a> : null}
            {item.owner ? <small>{item.owner}</small> : null}
          </article>
        ))}
      </div>
      {panel.listed.length ? (
        <div data-testid="listed-files">
          <h3>Payroll and tax files</h3>
          <ul>
            {panel.listed.map((item) => (
              <li key={item.name}>{item.href ? <a href={item.href} target="_blank" rel="noopener noreferrer">{item.name}</a> : item.name}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {status.enabled && writable ? (
        <form
          className="fin-request"
          data-testid="request-documents"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(wholePackage ? "package_refused" : "request");
          }}
        >
          <h3>Request documents</h3>
          <p>Stage stays as it is. The map does not email anyone.</p>
          {missing.map((item) => (
            <label key={item.id}>
              <input
                type="checkbox"
                checked={picked.includes(item.id)}
                onChange={(event) => setPicked((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))}
              />
              {checklistLabel(item.id)}
            </label>
          ))}
          <label>
            Owner
            <select value={owner} onChange={(event) => setOwner(event.target.value)} required>
              <option value="">Name one owner</option>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
          </label>
          <label>
            Snooze until
            <input type="date" value={snooze} onChange={(event) => setSnooze(event.target.value)} />
          </label>
          <label>
            Note
            <input value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <label>
            <input type="checkbox" checked={wholePackage} onChange={(event) => setWholePackage(event.target.checked)} />
            Whole package declined
          </label>
          <button type="submit" disabled={pending || (!wholePackage && !picked.length)}>Request documents</button>
          <button
            type="button"
            disabled={pending || (!wholePackage && !picked.length)}
            onClick={() => void submit(wholePackage ? "package_refused" : "refused")}
          >
            Record as not available
          </button>
          {error ? <p>{error}</p> : null}
        </form>
      ) : null}
      {openRequests.length ? (
        <div data-testid="document-requests">
          {openRequests.map((item) => (
            <p key={item.id}>
              Waiting for approval
              {item.ownerName ? ` · ${item.ownerName}` : ""}
              {reviewer ? (
                <>
                  <button type="button" disabled={pending} onClick={() => void decide(item.id, "accepted")}>Approve</button>
                  <button type="button" disabled={pending} onClick={() => void decide(item.id, "rejected")}>Reject</button>
                </>
              ) : null}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}
