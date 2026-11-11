import type { PipeId } from "@/lib/filter";

const PIPE_IDS: readonly PipeId[] = ["sourced", "desk", "financial", "checks", "close", "contacted", "later", "dropped"];

export type PipeView = {
  /** Every stage. This is the pipeline default, not an active filter. */
  all: boolean;
  /** Meaningful only when `all` is false. Desk is included. */
  stage: PipeId;
};

/**
 * Missing `pstage` and `pstage=all` are the default: every stage, with no filter chip.
 * A real stage, including desk, is explicit (`pstage=desk`).
 */
export function parsePipeView(param: string | null | undefined): PipeView {
  if (param && param !== "all" && (PIPE_IDS as readonly string[]).includes(param)) {
    return { all: false, stage: param as PipeId };
  }
  return { all: true, stage: "desk" };
}

/** Pipeline "all stages" is the home view, so it does not count as a narrowing. */
export function pipelineStageFilter(param: string | null | undefined): string | null {
  return parsePipeView(param).all ? null : param || null;
}

/**
 * Dropped deals stay out of the all-stages home view.
 * They show for an explicit Dropped step, the dropped layer, or a search/broker widen.
 */
export function droppedDealsShown(view: { all: boolean; stage: PipeId; droppedLayer: boolean; searchWide: boolean }): boolean {
  if (view.droppedLayer || view.searchWide) return true;
  return !view.all && view.stage === "dropped";
}

/**
 * Land on the all-stages map follows the Land sites layer.
 * A chosen stage still includes the land at that stage.
 */
export function stageLandShown(view: { all: boolean; landLayer: boolean }): boolean {
  return view.landLayer || !view.all;
}
