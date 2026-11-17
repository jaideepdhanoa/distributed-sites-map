import { axisAlignedBox, type GroundBox, type LngLat } from "./measure";

export type DrawDraft = {
  points: LngLat[];
  box: GroundBox | null;
};

export function emptyDraft(): DrawDraft {
  return { points: [], box: null };
}

/** A drag keeps the start until the opposite corner is far enough to be a lot. */
export function draftFromDrag(start: LngLat, end: LngLat): DrawDraft {
  const box = axisAlignedBox(start, end);
  if (box.lengthFt < 4 || box.widthFt < 4) return { points: [start], box: null };
  return { points: [start, end], box };
}

export function undoPoint(draft: DrawDraft): DrawDraft {
  const points = draft.points.slice(0, -1);
  if (points.length < 2) return { points, box: null };
  const box = axisAlignedBox(points[0], points[points.length - 1]);
  if (box.lengthFt < 4 || box.widthFt < 4) return { points, box: null };
  return { points, box };
}

export type DrawCommand = "undo" | "cancel" | "escape" | "finish";

/**
 * Undo removes the last corner and stays in the tool.
 * Cancel and Escape drop the in-progress shape and leave the tool.
 * Finish saves a large enough shape, then leaves. An empty draft just leaves.
 */
export function applyDrawCommand(draft: DrawDraft, command: DrawCommand): {
  draft: DrawDraft;
  commit: GroundBox | null;
  close: boolean;
} {
  if (command === "undo") return { draft: undoPoint(draft), commit: null, close: false };
  if (command === "cancel" || command === "escape") return { draft: emptyDraft(), commit: null, close: true };
  const commit = draft.box && draft.box.lengthFt >= 4 && draft.box.widthFt >= 4 ? draft.box : null;
  return { draft: emptyDraft(), commit, close: true };
}
