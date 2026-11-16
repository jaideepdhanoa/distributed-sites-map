"use client";

import { catchError, type ErrorInfo } from "next/error";

function PanelFallback({ name }: { name: string }, { retry }: ErrorInfo) {
  return (
    <div className="panel-error" role="alert">
      <p className="eyebrow">{name}</p>
      <p>This panel could not load.</p>
      <button type="button" className="paper-btn" onClick={() => retry()}>Try again</button>
    </div>
  );
}

/** One panel can fail without blanking the map, the list, or the record. */
export const PanelBoundary = catchError(PanelFallback);
