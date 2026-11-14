import { droppedStage } from "@/lib/actions/nextStepTypes";

export function SuggestedDropMark({
  reason,
  stageGroup,
  stage,
  compact = false,
}: {
  reason?: string | null;
  stageGroup?: string | null;
  stage?: string | null;
  compact?: boolean;
}) {
  const text = String(reason || "").trim();
  if (!text || droppedStage(stageGroup, stage)) return null;
  if (compact) {
    return (
      <span className="suggested-inline" data-testid="suggested-drop" title={`Suggested drop: ${text}`}>
        {`Suggested drop: ${text}`}
      </span>
    );
  }
  return (
    <span className="note" data-testid="suggested-drop">
      <span className="badge pending">Suggested drop</span>
      {` ${text}`}
    </span>
  );
}
