"use client";

import { spaceRollup } from "@/lib/spaces/slots";

export default function SpaceSummary({
  count,
  slots,
  note,
  onMark,
}: {
  count: number;
  slots: number;
  note?: string;
  onMark?: () => void;
}) {
  const line = spaceRollup(count, slots);
  return (
    <div className="space-summary" data-testid="space-summary">
      {onMark ? (
        <button type="button" className="text-link" data-testid="space-summary-line" onClick={onMark}>{line}</button>
      ) : (
        <p data-testid="space-summary-line">{line}</p>
      )}
      {onMark ? (
        <button type="button" className="paper-btn" data-testid="mark-space" onClick={onMark}>Mark space</button>
      ) : null}
      {note ? <p className="note" data-testid="space-map-note">{note}</p> : null}
    </div>
  );
}
