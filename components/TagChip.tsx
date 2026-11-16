"use client";

import { useState } from "react";
import type { TagView } from "@/lib/tags/map";
import { tagFamily } from "@/lib/tags/vocab";

export function TagChip({ chip, compact = false }: { chip: TagView; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const extra = [chip.since ? `since ${chip.since}` : "", chip.owner, chip.due ? `due ${chip.due}` : ""].filter(Boolean).join(" · ");
  return (
    <span className="tag-pair" data-family={chip.family}>
      <span className={`stage-pill tone-${chip.tone}`} data-testid={`chip-${chip.family}`} title={chip.help}>
        {chip.label}
        {extra ? <span className="tag-since">{extra}</span> : null}
      </span>
      {!compact && chip.note ? (
        <button type="button" className="text-link" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? "Hide full note" : "Show full note"}
        </button>
      ) : null}
      {open && chip.note ? <p className="next-full">{chip.note}</p> : null}
    </span>
  );
}

export function ChipRow({ chips, testId, titled = false }: { chips: TagView[]; testId: string; titled?: boolean }) {
  if (!chips.length) return null;
  return (
    <div className="card-chips" data-testid={testId}>
      {chips.map((chip) => {
        const title = titled ? tagFamily(chip.family)?.title.replace(/ check$/, "") : "";
        const shown = title ? { ...chip, label: `${title} · ${chip.label}` } : chip;
        return <TagChip key={chip.family} chip={shown} />;
      })}
    </div>
  );
}
