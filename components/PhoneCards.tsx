import type { ReactNode } from "react";

export type PhoneCard = {
  id: string;
  name: string;
  address?: string;
  stage: string;
  tone?: string;
  facts: string[];
  selected?: boolean;
  check?: ReactNode;
  onOpen: () => void;
};

export function PhoneCards({ rows }: { rows: PhoneCard[] }) {
  return (
    <ul className="list-cards" data-testid="phone-cards">
      {rows.map((row) => {
        const facts = row.facts.map((fact) => fact.trim()).filter(Boolean);
        return (
          <li key={row.id} className={row.selected ? "on" : undefined}>
            {row.check}
            <button type="button" className="list-row" onClick={row.onOpen}>
              <span className="phone-card-name" title={row.name}>{row.name}</span>
              {row.address ? <span className="site-address" title={row.address}>{row.address}</span> : null}
              <span className="phone-card-stage">
                <span className={`stage-pill tone-${row.tone || "pine"}`}>{row.stage}</span>
              </span>
              {facts.length ? (
                <span className="phone-card-meta">
                  {facts.map((fact, index) => (
                    <span className="phone-fact" key={`${row.id}-${index}`}>
                      {index > 0 ? <span className="phone-sep" aria-hidden="true">·</span> : null}
                      {fact}
                    </span>
                  ))}
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
