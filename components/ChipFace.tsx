"use client";

import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { chipFace } from "@/lib/chips";
import { placeTip } from "@/lib/listLook";

/**
 * A chip, pill, or badge is a short label on one line (at most 28 characters).
 * More than one word is fine. A sentence, or clauses joined with a middle dot,
 * belongs in the tooltip, on the card, or in a column. The chip does not take
 * the click; a list row still opens the site.
 */
export function ChipFace({
  label,
  className,
  detail,
  testId,
  pending,
}: {
  label: string;
  className: string;
  detail?: string;
  testId?: string;
  pending?: string;
}) {
  const face = chipFace(label);
  const tip = [face.title, (detail || "").replace(/\s+/g, " ").trim()].filter(Boolean).join(" ");
  return (
    <span className="stage-hold">
      <TipTrigger className={className} testId={testId} tip={tip}>{face.label}</TipTrigger>
      {pending ? (
        <span className="stage-wait" data-testid="stage-pending">
          waiting
          <span className="sr">{pending}</span>
        </span>
      ) : null}
      {tip ? <span className="sr" data-testid="stage-decision-tip">{tip}</span> : null}
    </span>
  );
}

/** Hover, focus, or tap. The note is portaled so a table cell cannot clip it. */
export function TipTrigger({
  className,
  testId,
  tip,
  children,
}: {
  className: string;
  testId?: string;
  tip?: string;
  children: ReactNode;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<ReturnType<typeof placeTip> | null>(null);
  function place(next: boolean) {
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    const node = anchor.current;
    if (!next || !node || !tip || typeof window === "undefined") {
      setOpen(false);
      return;
    }
    const rect = node.getBoundingClientRect();
    setBox(placeTip(
      { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
      { width: window.innerWidth, height: window.innerHeight },
    ));
    setOpen(true);
  }
  function hide() {
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => place(false), 160);
  }
  return (
    <>
      <span
        ref={anchor}
        className={className}
        data-testid={testId}
        aria-label={tip || undefined}
        onMouseEnter={() => place(true)}
        onMouseLeave={hide}
        onFocus={() => place(true)}
        onBlur={hide}
        onClick={(event) => {
          if (!tip) return;
          event.stopPropagation();
          place(!open);
        }}
      >
        {children}
      </span>
      {open && tip && box ? createPortal(
        <span
          className="stage-tip is-floating"
          role="tooltip"
          data-testid={testId ? `${testId}-tip` : "chip-tip"}
          style={{
            display: "block",
            position: "fixed",
            left: box.left,
            top: box.top,
            maxWidth: box.maxWidth,
            zIndex: 80,
            pointerEvents: "none",
          }}
        >
          {tip}
        </span>,
        document.body,
      ) : null}
    </>
  );
}
