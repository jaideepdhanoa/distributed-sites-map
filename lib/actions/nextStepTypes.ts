import { stageTitle } from "@/lib/labels";

export const NEXT_STEP_TYPES = [
  { id: "stage_move", label: "Prioritize: push to Financials" },
  { id: "knock_off", label: "Drop with a reason" },
  { id: "mark_duplicate", label: "Mark duplicate" },
  { id: "bring_back", label: "Bring back" },
  { id: "work_item", label: "Work item" },
] as const;

export type NextStepTypeId = (typeof NEXT_STEP_TYPES)[number]["id"];

export const NEXT_STAGE_IDS = ["desk", "financial", "checks"] as const;

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

export function allowsAssignee(detail: string | null | undefined): boolean {
  const type = nextStepType(detail);
  return type === "work_item" || type === "stage_move";
}

export function allowsDate(detail: string | null | undefined): boolean {
  return allowsAssignee(detail);
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
