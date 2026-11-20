"use client";

import { useState } from "react";
import { ChipFace } from "./ChipFace";
import type { TagView } from "@/lib/tags/map";
import { tagFamily } from "@/lib/tags/vocab";

export function TagChip({ chip, compact = false, caption = "" }: { chip: TagView; compact?: boolean; caption?: string }) {
  const [open, setOpen] = useState(false);
  const extra = [caption, chip.since ? `since ${chip.since}` : "", chip.owner, chip.due ? `due ${chip.due}` : "", chip.help].filter(Boolean).join(". ");
  return (
    <span className="tag-pair" data-family={chip.family}>
      <ChipFace className={`stage-pill tone-${chip.tone}`} testId={`chip-${chip.family}`} label={chip.label} detail={extra} />
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
        return <TagChip key={chip.family} chip={chip} caption={title || ""} />;
      })}
    </div>
  );
}
