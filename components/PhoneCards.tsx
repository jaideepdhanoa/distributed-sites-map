import type { ReactNode } from "react";
import { ChipFace } from "./ChipFace";

export type PhoneCard = {
  id: string;
  name: string;
  address?: string;
  stage: string;
  stageNote?: string;
  tone?: string;
  action?: string;
  facts: string[];
  chips?: ReactNode;
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
          <li data-site-row={row.id} key={row.id} className={row.selected ? "on" : undefined}>
            {row.check}
            <button type="button" className="list-row" onClick={row.onOpen}>
              <span className="phone-card-name" title={row.name}>{row.name}</span>
              {row.address ? <span className="site-address" title={row.address}>{row.address}</span> : null}
              <span className="phone-card-stage">
                <ChipFace className={`stage-pill tone-${row.tone || "pine"}`} testId="stage-chip" label={row.stage} detail={row.stageNote} />
                {row.chips}
              </span>
              {row.action && <span className="mobile-next-action"><b>Next</b> {row.action}</span>}
              {facts.length ? (
                <span className="phone-card-meta">
                  {facts.map((fact, index) => (
                    <span className="phone-fact" key={`${row.id}-${index}`}>
                      {fact}
                      {index < facts.length - 1 ? <span className="phone-sep" aria-hidden="true">·</span> : null}
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
