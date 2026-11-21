"use client";

import { useState } from "react";
import { ChipFace } from "./ChipFace";
import { LAND_PAUSED_LABEL, LAND_PAUSED_NOTE, typeChip } from "@/lib/listLook";
import { storedScoreView, type StoredScoreInput } from "@/lib/scoreDisplay";
import { stageTone } from "@/lib/labels";

export function TypeChip({ value }: { value: string }) {
  const chip = typeChip(value);
  return <ChipFace className={`stage-pill tone-${chip.tone}`} testId="type-chip" label={chip.label} />;
}

export function StageChip({
  stage,
  group,
  detail,
  quiet,
}: {
  stage: string;
  group: string;
  detail?: string;
  quiet?: boolean;
}) {
  return (
    <ChipFace
      className={`stage-pill tone-${quiet ? "quiet" : stageTone({ stage_group: group })}`}
      testId="stage-chip"
      label={stage}
      detail={detail}
    />
  );
}

export function CountyChip({ label, note }: { label: string; note: string }) {
  return <ChipFace className="stage-pill tone-quiet" testId="county-chip" label={label} detail={note} />;
}

export function LandPausedChip() {
  return <ChipFace className="stage-pill tone-sand" testId="land-paused" label={LAND_PAUSED_LABEL} detail={LAND_PAUSED_NOTE} />;
}

/** The score number. Hover or tap shows the same parts line as the site panel. */
export function ScoreCell({ input }: { input: StoredScoreInput }) {
  const view = storedScoreView(input);
  const label = view.status === "not_scored" ? "Not scored" : view.status === "provisional" ? "Provisional" : view.chip || "—";
  const [open, setOpen] = useState(false);
  if (label === "—") return <span>—</span>;
  return (
    <span className="stage-hold" data-open={open ? "1" : undefined}>
      <span
        className="stage-pill tone-pine score-chip"
        data-testid="list-score"
        role="button"
        tabIndex={0}
        title={view.line || undefined}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        {label}
      </span>
      {view.line ? <span className="stage-tip" role="tooltip" data-testid="score-breakdown-tip">{view.line}</span> : null}
    </span>
  );
}
