"use client";

import { spaceRollup } from "@/lib/spaces/slots";

export default function SpaceSummary({
  count,
  slots,
  sqft = 0,
  note,
  onMark,
}: {
  count: number;
  slots: number;
  sqft?: number;
  note?: string;
  onMark?: () => void;
}) {
  const line = spaceRollup(count, slots, sqft);
  return (
    <div className="space-summary" data-testid="space-summary">
      {onMark ? (
        <button type="button" className="text-link" data-testid="space-summary-line" onClick={onMark}>{line}</button>
      ) : (
        <p data-testid="space-summary-line">{line}</p>
      )}
      {note ? <p className="note" data-testid="space-map-note">{note}</p> : null}
    </div>
  );
}
