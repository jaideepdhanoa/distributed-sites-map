import { stageTitle } from "@/lib/labels";
import { stageKey } from "@/lib/stageOverlay";

export const NEXT_STEP_TYPES = [
  { id: "stage_move", label: "Move stage" },
  { id: "knock_off", label: "Drop with a reason" },
  { id: "mark_duplicate", label: "Mark duplicate" },
  { id: "bring_back", label: "Bring back" },
  { id: "work_item", label: "Work item" },
] as const;

export type NextStepTypeId = (typeof NEXT_STEP_TYPES)[number]["id"];

export const NEXT_STAGE_IDS = ["desk", "financial", "checks", "close"] as const;

export type NextStageId = (typeof NEXT_STAGE_IDS)[number];

export function nextStepType(detail: string | null | undefined): NextStepTypeId {
  const id = String(detail || "").trim();
  if (NEXT_STEP_TYPES.some((item) => item.id === id)) return id as NextStepTypeId;
  return "work_item";
}

export function nextStepTypeLabel(detail: string | null | undefined): string {
  const id = nextStepType(detail);
  return NEXT_STEP_TYPES.find((item) => item.id === id)?.label || "Work item";
}

export function nextStageChoices(): { id: NextStageId; label: string }[] {
  return NEXT_STAGE_IDS.map((id) => ({ id, label: stageTitle(id) }));
}

/** The stage after the one on the card. Empty when the row is already at Offer and close. */
export function forwardStageId(stageGroup?: string | null, stage?: string | null): NextStageId | "" {
  const group = String(stageGroup || "").trim().toLowerCase();
  const key = group || stageKey(stage || "");
  if (key === "financial" || key === "contacted") return "checks";
  if (key === "checks") return "close";
  if (key === "close" || key === "later" || key === "dropped") return "";
  return "financial";
}

/** Names the next stage. A deal already in Financial screen says "Move to Site checks". */
export function stageMoveLabel(stageGroup?: string | null, stage?: string | null): string {
  const id = forwardStageId(stageGroup, stage);
  if (!id) return "Move stage";
  return `Move to ${stageTitle(id)}`;
}

export function allowsAssignee(detail: string | null | undefined): boolean {
  const type = nextStepType(detail);
  return type === "work_item" || type === "stage_move";
}

export function allowsDate(detail: string | null | undefined): boolean {
  return allowsAssignee(detail);
}

export function droppedStage(stageGroup?: string | null, stage?: string | null): boolean {
  if (String(stageGroup || "").trim().toLowerCase() === "dropped") return true;
  return /^dropped\b/i.test(String(stage || "").trim());
}

export type EmptyNextStepAction = { id: NextStepTypeId; prominent: boolean };

/** On a dropped site, Bring back is the primary empty-state action. */
export function emptyNextStepActions(stageGroup?: string | null, stage?: string | null): EmptyNextStepAction[] {
  if (droppedStage(stageGroup, stage)) {
    return [
      { id: "bring_back", prominent: true },
      { id: "mark_duplicate", prominent: false },
      { id: "stage_move", prominent: false },
      { id: "knock_off", prominent: false },
    ];
  }
  return [
    { id: "stage_move", prominent: true },
    { id: "knock_off", prominent: false },
    { id: "mark_duplicate", prominent: false },
  ];
}

export function exportStage(detail: string | null | undefined, proposedValue: string): string {
  const type = nextStepType(detail);
  if (!detail) return "";
  if (type === "knock_off") return "Dropped";
  if (type === "mark_duplicate") return "";
  if (type === "bring_back" || type === "stage_move") {
    return (NEXT_STAGE_IDS as readonly string[]).includes(proposedValue) ? stageTitle(proposedValue) : "";
  }
  return "";
}
