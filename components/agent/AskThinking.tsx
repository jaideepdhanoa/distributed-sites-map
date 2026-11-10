"use client";

import { STILL_WORKING_LABEL, THINKING_LABEL } from "@/lib/ask/empty";

export function AskThinking({ slow }: { slow?: boolean }) {
  return (
    <p className="ask-thinking" data-testid="ask-thinking" role="status">
      <span className="ask-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {slow ? STILL_WORKING_LABEL : THINKING_LABEL}
    </p>
  );
}
