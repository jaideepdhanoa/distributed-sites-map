import { droppedStage } from "@/lib/actions/nextStepTypes";

export function SuggestedDropMark({
  reason,
  stageGroup,
  stage,
}: {
  reason?: string | null;
  stageGroup?: string | null;
  stage?: string | null;
}) {
  const text = String(reason || "").trim();
  if (!text || droppedStage(stageGroup, stage)) return null;
  return (
    <span className="note" data-testid="suggested-drop">
      <span className="badge pending">Suggested drop</span>
      {` ${text}`}
    </span>
  );
}
