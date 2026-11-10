"use client";

import { applySuggestedDraft } from "@/lib/agent/draft";
import type { VisibleRecommendation } from "@/lib/agent/recommend";
import "./agent.css";

export function SuggestedBlock({
  item,
  onUse,
  onDismiss,
}: {
  item: VisibleRecommendation;
  onUse: (draft: string, id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const decision = item.kind === "decision" && item.decision !== "none"
    ? item.decision === "approve" ? "Approve" : "Reject"
    : "";
  return (
    <section className="suggest" data-testid="suggested-block">
      <div className="suggest-head">
        <p className="eyebrow">Suggested</p>
        <button type="button" className="close" aria-label="Dismiss suggestion" data-testid="suggested-dismiss" onClick={() => onDismiss(item.id)}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
      {decision ? <p><strong>{decision}</strong></p> : null}
      <p>{item.draftText}</p>
      <p>{item.rationale}</p>
      <ul>
        {item.sources.map((source) => (
          <li key={`${source.label}-${source.url || source.ref}`}>
            {source.url ? (
              <a className="text-link" href={source.url} target={source.url.startsWith("http") ? "_blank" : undefined} rel={source.url.startsWith("http") ? "noopener noreferrer" : undefined}>
                {source.label}{source.url.startsWith("http") ? " ↗" : ""}
              </a>
            ) : (
              <span>{source.label}{source.ref ? ` · ${source.ref}` : ""}</span>
            )}
          </li>
        ))}
      </ul>
      <p className="confidence">{item.confidence} confidence</p>
      <button
        type="button"
        className="paper-btn"
        data-testid="suggested-use"
        onClick={() => {
          const filled = applySuggestedDraft(item.draftText);
          onUse(filled.composer, item.id);
        }}
      >
        Use this
      </button>
    </section>
  );
}
