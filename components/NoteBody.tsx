"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { formatNoteBlocks, type NoteBlock } from "@/lib/noteDisplay";

function Blocks({ blocks }: { blocks: NoteBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => (
        block.kind === "ol" ? (
          <ol key={index}>
            {block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}
          </ol>
        ) : (
          <p key={index}>{block.text}</p>
        )
      ))}
    </>
  );
}

/** Clamps a note to about three lines. Expanded text is a display transform of the same string. */
export default function NoteBody({ text }: { text: string }) {
  const blocks = formatNoteBlocks(text);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const full = useRef<HTMLDivElement>(null);
  const clamped = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const measure = full.current;
    const box = clamped.current;
    if (!measure || !box) return;
    setOverflows(measure.scrollHeight > box.clientHeight + 1);
  }, [text, open]);
  if (!blocks.length) return null;
  const toggle = overflows || open;
  return (
    <div className="note-body" data-testid="note-body">
      <div className="note-measure" ref={full} aria-hidden="true">
        <Blocks blocks={blocks} />
      </div>
      <div ref={clamped} className={open ? "note-blocks" : "note-blocks is-clamped"} data-open={open ? "true" : "false"}>
        <Blocks blocks={blocks} />
      </div>
      {toggle ? (
        <button type="button" className="text-link" aria-expanded={open} data-testid="note-more" onClick={() => setOpen((value) => !value)}>
          {open ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}
