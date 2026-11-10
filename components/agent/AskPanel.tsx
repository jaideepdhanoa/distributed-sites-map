"use client";

import { useEffect, useRef, useState } from "react";
import { EMPTY_ANSWER } from "@/lib/ask/empty";
import { askFailure, beginAsk, composerAfter, finishAsk, markStillWorking, showAskText, ASK_CLIENT_TIMEOUT_MS, ASK_STILL_WORKING_MS, type AskTurn } from "@/lib/ask/wait";
import { AskMarkdown } from "./AskMarkdown";
import { AskThinking } from "./AskThinking";
import "./agent.css";

type Source = { label: string; href: string };
type Turn = AskTurn & { sources?: Source[] };

export function AskPanel({
  open,
  site,
  onClearSite,
  onClose,
}: {
  open: boolean;
  site: { id: string; name: string } | null;
  onClearSite: () => void;
  onClose: () => void;
}) {
  const [ready, setReady] = useState<boolean | null>(null);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const runId = useRef(0);

  useEffect(() => {
    const node = logRef.current;
    if (!node) return;
    const pin = () => { node.scrollTop = node.scrollHeight; };
    pin();
    const frame = requestAnimationFrame(pin);
    return () => cancelAnimationFrame(frame);
  }, [turns, pending, open]);

  useEffect(() => {
    const node = composerRef.current;
    if (!node) return;
    node.style.height = "44px";
    node.style.height = `${Math.min(node.scrollHeight, 112)}px`;
  }, [question, open]);

  useEffect(() => {
    if (!open) return;
    let cancel = false;
    fetch("/api/ask/status")
      .then(async (response) => (response.ok ? (await response.json()) as { ready?: boolean } : { ready: false }))
      .then((body) => { if (!cancel) setReady(Boolean(body.ready)); })
      .catch(() => { if (!cancel) setReady(false); });
    return () => { cancel = true; };
  }, [open]);

  if (!open) return null;

  async function send(preset?: string) {
    const text = (preset ?? question).trim();
    if (!text || pending || ready === false) return;
    const requestId = runId.current + 1;
    runId.current = requestId;
    setPending(true);
    setNotice("");
    setTurns((current) => beginAsk(current, text));
    const controller = new AbortController();
    const slowTimer = window.setTimeout(() => {
      if (runId.current === requestId) setTurns((current) => markStillWorking(current));
    }, ASK_STILL_WORKING_MS);
    const timeoutTimer = window.setTimeout(() => controller.abort(), ASK_CLIENT_TIMEOUT_MS);
    let succeeded = false;
    let settled = false;
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, siteId: site?.id || null }),
        signal: controller.signal,
      });
      if (runId.current !== requestId) return;
      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        const message = payload.error || askFailure(new Error("network")).text;
        settled = true;
        setTurns((current) => finishAsk(current, { text: message, error: true, linkRetry: true }));
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let shown = "";
      while (true) {
        const step = await reader.read();
        if (step.done) break;
        if (runId.current !== requestId) return;
        buffer += decoder.decode(step.value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";
        for (const chunk of chunks) {
          const line = chunk.split("\n").find((item) => item.startsWith("data: "));
          if (!line) continue;
          const event = JSON.parse(line.slice(6)) as { delta?: string; done?: boolean; text?: string; gap?: boolean; error?: boolean; sources?: Source[] };
          if (event.delta) {
            shown += event.delta;
            const snapshot = shown;
            setTurns((current) => showAskText(current, snapshot));
          }
          if (event.done) {
            const finalText = (event.text || shown).trim() || EMPTY_ANSWER;
            succeeded = !event.error && finalText !== EMPTY_ANSWER;
            settled = true;
            setTurns((current) => finishAsk(current, {
              text: finalText,
              gap: event.gap,
              error: event.error || finalText === EMPTY_ANSWER,
              sources: event.sources || [],
            }));
          }
        }
      }
    } catch (error) {
      if (runId.current !== requestId) return;
      settled = true;
      setTurns((current) => finishAsk(current, askFailure(error)));
    } finally {
      window.clearTimeout(slowTimer);
      window.clearTimeout(timeoutTimer);
      if (runId.current === requestId) {
        if (!settled) setTurns((current) => finishAsk(current, askFailure(new Error("network"))));
        setPending(false);
        setQuestion((current) => composerAfter(text, current, succeeded));
      }
    }
  }

  function makeWorkItem(text: string) {
    if (!site) {
      setNotice("Open a site to file this as a work item.");
      return;
    }
    window.dispatchEvent(new CustomEvent("sites-prefill-work-item", { detail: { title: text.slice(0, 120) } }));
    onClose();
  }

  const unset = ready === false;

  return (
    <aside className="ask-panel open" data-testid="ask-panel" aria-label="Ask">
      <div className="ask-head">
        <div className="ask-title">
          <p className="eyebrow">Ask</p>
          {site ? null : <p className="layer-meta" data-testid="ask-scope">Portfolio and markets</p>}
        </div>
        <button type="button" className="close" aria-label="Close Ask" onClick={onClose}><span aria-hidden="true">×</span></button>
      </div>
      {site ? (
        <button type="button" className="removable" data-testid="ask-chip" onClick={onClearSite}>
          {site.name}<span aria-hidden="true">×</span>
        </button>
      ) : null}
      {unset ? <p data-testid="ask-unset">Ask isn&apos;t set up yet</p> : null}
      <div className="ask-log" ref={logRef}>
        {turns.map((turn, index) => (
          <div key={`${turn.role}-${index}`}>
            {turn.role === "ask" && turn.pending && !turn.text ? <AskThinking slow={turn.slow} /> : null}
            {turn.role === "ask" && turn.text ? <AskMarkdown text={turn.text} /> : null}
            {turn.role === "user" ? <p className="ask-bubble">{turn.text}</p> : null}
            {turn.error && turn.linkRetry ? (
              <button type="button" className="text-link" data-testid="ask-retry" disabled={pending} onClick={() => void send(turns[index - 1]?.text || question)}>
                Try again
              </button>
            ) : null}
            {turn.error && !turn.linkRetry ? (
              <button type="button" className="paper-btn" data-testid="ask-retry" disabled={pending} onClick={() => void send(turns[index - 1]?.text || question)}>
                Try again
              </button>
            ) : null}
            {turn.gap ? (
              <button type="button" className="paper-btn" data-testid="ask-work-item" onClick={() => makeWorkItem(turns[index - 1]?.text || turn.text)}>
                Make it a work item
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {notice ? <p className="note">{notice}</p> : null}
      {unset ? null : (
        <form
          className="ask-form"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label className="sr" htmlFor="ask-question">Question</label>
          <textarea
            id="ask-question"
            ref={composerRef}
            className="field"
            data-testid="ask-composer"
            rows={1}
            maxLength={2000}
            value={question}
            disabled={pending}
            aria-busy={pending}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={site ? "Ask about this site" : "Ask about the portfolio"}
          />
          <button type="submit" className="primary" disabled={pending || !question.trim()} aria-busy={pending}>{pending ? "Thinking…" : "Ask"}</button>
        </form>
      )}
    </aside>
  );
}
