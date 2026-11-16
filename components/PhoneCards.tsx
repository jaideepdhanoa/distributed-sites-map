import type { ReactNode } from "react";

export type PhoneCard = {
  id: string;
  name: string;
  address?: string;
  stage: string;
  tone?: string;
  score: string;
  asking: string;
  metric: string;
  selected?: boolean;
  check?: ReactNode;
  onOpen: () => void;
};

export function PhoneCards({ rows }: { rows: PhoneCard[] }) {
  return (
    <ul className="list-cards" data-testid="phone-cards">
      {rows.map((row) => (
        <li key={row.id} className={row.selected ? "on" : undefined}>
          {row.check}
          <button type="button" className="list-row" onClick={row.onOpen}>
            <span className="phone-card-name" title={row.name}>{row.name}</span>
            {row.address ? <span className="site-address" title={row.address}>{row.address}</span> : null}
            <span className="phone-card-meta">
              <span className={`stage-pill tone-${row.tone || "pine"}`}>{row.stage}</span>
              <span className="phone-fact" data-testid="phone-score"><span className="phone-fact-label">Score</span>{row.score}</span>
              <span className="phone-fact">{row.asking}</span>
              <span className="phone-fact">{row.metric}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
