"use client";

import type { ReactNode } from "react";
import { ChipFace, TipTrigger } from "./ChipFace";
import { LAND_PAUSED_LABEL, LAND_PAUSED_NOTE, UNIVERSE_STAGE_LABEL, typeChip } from "@/lib/listLook";
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

/** Stage and type sit in one cell on both lists. */
export function StageTypeCell({
  stage,
  group,
  detail,
  type,
  quiet,
  hideStage,
  land,
  extra,
}: {
  stage: string;
  group: string;
  detail?: string;
  type?: string;
  quiet?: boolean;
  hideStage?: boolean;
  land?: boolean;
  extra?: ReactNode;
}) {
  return (
    <span className="stage-cell">
      {!hideStage && (quiet ? <StageChip stage={UNIVERSE_STAGE_LABEL} group="" quiet /> : <StageChip stage={stage} group={group} detail={detail} />)}
      {type ? <TypeChip value={type} /> : null}
      {land ? <LandPausedChip /> : null}
      {extra}
    </span>
  );
}

/** The score number. Hover or tap shows the same parts line as the site panel. */
export function ScoreCell({ input }: { input: StoredScoreInput }) {
  const view = storedScoreView(input);
  const label = view.status === "not_scored" ? "Not scored" : view.status === "provisional" ? "Provisional" : view.chip || "—";
  if (label === "—") return <span>—</span>;
  return (
    <span className="stage-hold">
      <TipTrigger className="stage-pill tone-pine score-chip" testId="list-score" tip={view.line || undefined}>{label}</TipTrigger>
      {view.line ? <span className="sr" data-testid="score-breakdown-tip">{view.line}</span> : null}
    </span>
  );
}
