"use client";

import { useEffect, useRef, useState } from "react";
import { EMPTY_ANSWER } from "@/lib/ask/empty";
import { AskMarkdown } from "./AskMarkdown";
import "./agent.css";

type Source = { label: string; href: string };
type Turn = { role: "user" | "ask"; text: string; gap?: boolean; error?: boolean; sources?: Source[] };

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

  useEffect(() => {
    const node = logRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [turns, pending, open]);

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
    setPending(true);
    setNotice("");
    if (!preset) setQuestion("");
    setTurns((current) => [...current, { role: "user", text }, { role: "ask", text: "" }]);
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, siteId: site?.id || null }),
      });
      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        const message = payload.error || "Ask isn't set up yet";
        setTurns((current) => current.slice(0, -1).concat({ role: "ask", text: message, error: true }));
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let shown = "";
      while (true) {
        const step = await reader.read();
        if (step.done) break;
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
            setTurns((current) => current.slice(0, -1).concat({ role: "ask", text: snapshot }));
          }
          if (event.done) {
            const finalText = (event.text || shown).trim() || EMPTY_ANSWER;
            setTurns((current) => current.slice(0, -1).concat({
              role: "ask",
              text: finalText,
              gap: event.gap,
              error: event.error || finalText === EMPTY_ANSWER,
              sources: event.sources || [],
            }));
          }
        }
      }
    } catch {
      setTurns((current) => current.slice(0, -1).concat({ role: "ask", text: EMPTY_ANSWER, error: true }));
    } finally {
      setPending(false);
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
        <p className="eyebrow">Ask</p>
        <button type="button" className="close" aria-label="Close Ask" onClick={onClose}><span aria-hidden="true">×</span></button>
      </div>
      {site ? (
        <button type="button" className="removable" data-testid="ask-chip" onClick={onClearSite}>
          {site.name}<span aria-hidden="true">×</span>
        </button>
      ) : (
        <p className="note" data-testid="ask-scope">Portfolio and markets</p>
      )}
      {unset ? <p data-testid="ask-unset">Ask isn&apos;t set up yet</p> : null}
      <div className="ask-log" ref={logRef}>
        {turns.map((turn, index) => (
          <div key={`${turn.role}-${index}`}>
            {turn.role === "ask" && turn.text ? <AskMarkdown text={turn.text} /> : <p className="ask-bubble">{turn.text}</p>}
            {turn.error ? (
              <button type="button" className="paper-btn" data-testid="ask-retry" disabled={pending} onClick={() => void send(turns[index - 1]?.text || "")}>
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
          <textarea id="ask-question" className="field" data-testid="ask-composer" rows={3} maxLength={2000} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={site ? "Ask about this site" : "Ask about the portfolio"} />
          <button type="submit" className="primary" disabled={pending || !question.trim()}>Ask</button>
        </form>
      )}
    </aside>
  );
}
