import { stageTitle } from "@/lib/labels";
import { assertClean } from "@/lib/policy/banned";
import { InputError, parseBody, parseDate } from "./text";
import {
  NEXT_STAGE_IDS,
  NEXT_STEP_TYPES,
  allowsAssignee,
  allowsDate,
  nextStepType,
} from "./nextStepTypes";

export type { NextStepTypeId } from "./nextStepTypes";
export { exportStage, nextStepType, nextStepTypeLabel, nextStageChoices, allowsAssignee, allowsDate, NEXT_STEP_TYPES, NEXT_STAGE_IDS } from "./nextStepTypes";

export type NextStepDraft = {
  detail: string | null;
  title: string;
  proposedValue: string;
  reason: string;
  targetOn: string | null;
  ownerId: string | null;
};

function ownerOrNull(value: string | null | undefined, users: { u: string }[]): string | null {
  const id = String(value || "").trim().toLowerCase();
  if (!id) return null;
  if (!users.some((user) => user.u === id)) throw new InputError("Choose an account from the list.");
  return id;
}

export function normalizeNextStep(
  input: {
    detail?: string | null;
    title?: string | null;
    proposedValue?: string | null;
    reason?: string | null;
    targetOn?: string | null;
    ownerId?: string | null;
  },
  users: { u: string }[],
): NextStepDraft {
  const explicit = String(input.detail || "").trim();
  if (explicit && !NEXT_STEP_TYPES.some((item) => item.id === explicit)) {
    throw new InputError("Choose a next step type.");
  }
  const type = nextStepType(explicit);
  const reasonText = String(input.reason || "").trim();
  const date = allowsDate(explicit || type) ? parseDate(input.targetOn) : null;
  const owner = allowsAssignee(explicit || type) ? ownerOrNull(input.ownerId, users) : null;
  if (type === "knock_off") {
    if (!reasonText) throw new InputError("Add a reason.");
    const reason = parseBody(reasonText, "reason", 2000);
    assertClean(reason);
    return {
      detail: "knock_off",
      title: "Drop from pipeline",
      proposedValue: "Dropped",
      reason,
      targetOn: null,
      ownerId: null,
    };
  }
  if (type === "mark_duplicate") {
    const survivor = String(input.proposedValue || "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(survivor)) throw new InputError("Name the surviving record.");
    if (!reasonText) throw new InputError("Confirm why these are the same parcel.");
    const reason = parseBody(reasonText, "reason", 2000);
    assertClean(reason);
    const title = `Duplicate of ${survivor}`;
    assertClean(title);
    return {
      detail: "mark_duplicate",
      title,
      proposedValue: survivor,
      reason,
      targetOn: null,
      ownerId: null,
    };
  }
  if (type === "bring_back" || type === "stage_move") {
    const stage = String(input.proposedValue || "").trim();
    if (!(NEXT_STAGE_IDS as readonly string[]).includes(stage)) throw new InputError("Choose a stage.");
    const label = stageTitle(stage);
    const title = type === "bring_back" ? `Bring back to ${label}` : `Advance to ${label}`;
    assertClean(title);
    return {
      detail: type,
      title,
      proposedValue: stage,
      reason: "",
      targetOn: type === "stage_move" ? date : null,
      ownerId: type === "stage_move" ? owner : null,
    };
  }
  const title = parseBody(input.title || input.proposedValue, "title", 120);
  assertClean(title);
  const reason = reasonText ? parseBody(reasonText, "note", 2000) : "";
  if (reason) assertClean(reason);
  return {
    detail: explicit ? "work_item" : null,
    title,
    proposedValue: title,
    reason,
    targetOn: date,
    ownerId: owner,
  };
}
