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
