"use client";

import { useEffect, useRef } from "react";
import { statusLabel } from "@/lib/conflicts/view";
import { withoutGmail } from "@/lib/displayText";
import type { GridCell } from "@/lib/pnl/grid";
import { sourceView } from "@/lib/pnl/sourceLink";

function SourceLine({ cell }: { cell: Extract<GridCell, { kind: "value" | "missing" }> }) {
  const view = sourceView({
    document: cell.sourceDocument,
    page: cell.sourcePage,
    href: cell.sourceHref || "",
    capturedLabel: cell.capturedLabel,
    gmailHref: cell.gmailHref || "",
  });
  const page = view.pageAside || (view.pageNote ? `· ${view.pageNote}` : "");
  return (
    <>
      <p>
        {view.href ? (
          <a className="text-link" href={view.href} target="_blank" rel="noopener noreferrer">{view.label} ↗</a>
        ) : view.label}
        {page ? <span className="pnl-page">{page}</span> : null}
      </p>
      {view.gmailHref ? (
        <p><a className="text-link" href={view.gmailHref} target="_blank" rel="noopener noreferrer">Open in Gmail ↗</a></p>
      ) : null}
    </>
  );
}

function statusText(cell: GridCell): string {
  if (cell.kind !== "value") return "";
  if (cell.status === "calculated") return "Calculated";
  if (cell.status === "estimated") return "Estimated";
  if (cell.status === "normalized") return "Normalized";
  return "Reported";
}

export default function PnlLinePopover({
  label,
  cell,
  sheet = false,
  style,
  onClose,
}: {
  label: string;
  cell: GridCell;
  sheet?: boolean;
  style?: React.CSSProperties;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      closeRef.current();
    }
    function onPointer(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (ref.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-pnl-anchor='open']")) return;
      closeRef.current();
    }
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={sheet ? "pnl-pop is-sheet" : "pnl-pop"}
      role="dialog"
      aria-label="Line source"
      data-testid="pnl-popover"
      style={sheet ? undefined : style}
    >
      <div className="pnl-pop-head">
        <strong>{label}</strong>
        <button type="button" className="close" aria-label="Close line source" onClick={() => closeRef.current()}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
      {cell.kind === "missing" ? (
        <div data-testid="pnl-missing-source">
          <p>Missing</p>
          <SourceLine cell={cell} />
          {cell.markerSource ? <p>{withoutGmail(cell.markerSource)}</p> : null}
          {cell.capturedLabel ? <p>Captured {cell.capturedLabel}</p> : null}
        </div>
      ) : null}
      {cell.kind === "blank" ? <p>Not in this statement.</p> : null}
      {cell.kind === "value" ? (
        <>
          <p>{cell.amount}{cell.share ? ` · ${cell.share}` : ""}</p>
          <p>{statusText(cell)}</p>
          <SourceLine cell={cell} />
          {cell.capturedLabel ? <p>Captured {cell.capturedLabel}</p> : null}
          {cell.flag ? <p className="pnl-flag">{cell.flag}</p> : null}
        </>
      ) : null}
      {cell.conflict ? (
        <div data-testid="pnl-conflict">
          <p>Conflict · {statusLabel(cell.conflict.status)}</p>
          {cell.conflict.sources.map((source, index) => {
            const view = sourceView({ document: source.document, page: source.page, href: "", capturedLabel: "" });
            const page = view.pageAside || view.pageNote;
            return <p key={index}>{withoutGmail(source.value)} · {view.label}{page ? ` · ${page}` : ""}</p>;
          })}
          <p>In use: {withoutGmail(cell.conflict.valueInUse)}</p>
        </div>
      ) : null}
    </div>
  );
}
