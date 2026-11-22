"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { commentList, type OpenPnlComment } from "@/lib/comments/anchor";
import { COMMENT_OPEN, readCommentAnchor } from "@/lib/comments/nav";
import { conflictList, type DataConflict } from "@/lib/conflicts/view";
import { emptyStatement, type PnlStatement } from "@/lib/pnl/statement";
import PnlOverlay from "../PnlOverlay";

/** Opens the financials grid from a discussion chip. Signed-in reads only. */
export default function CommentGridHost() {
  const [siteId, setSiteId] = useState("");
  const [focus, setFocus] = useState<{ type: "pnl_cell" | "pnl_line"; line: string; period: string } | null>(null);
  const [statement, setStatement] = useState<PnlStatement>(emptyStatement());
  const [conflicts, setConflicts] = useState<DataConflict[]>([]);
  const [comments, setComments] = useState<OpenPnlComment[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const anchor = readCommentAnchor((event as CustomEvent).detail);
      if (!anchor || anchor.type === "space" || anchor.type === "nda") return;
      setSiteId(anchor.siteId);
      setFocus({ type: anchor.type, line: anchor.line, period: anchor.period });
      setOpen(false);
    };
    window.addEventListener(COMMENT_OPEN, onOpen);
    return () => window.removeEventListener(COMMENT_OPEN, onOpen);
  }, []);

  useEffect(() => {
    if (!siteId || !focus) return undefined;
    let cancel = false;
    void fetch(`/api/data/financials/${encodeURIComponent(siteId)}`, { cache: "no-store" })
      .then(async (response) => (response.ok ? await response.json() as { pnl?: PnlStatement; conflicts?: unknown; comments?: unknown } : null))
      .then((body) => {
        if (cancel) return;
        if (!body?.pnl) {
          setFocus(null);
          setSiteId("");
          setOpen(false);
          return;
        }
        setStatement(body.pnl);
        setConflicts(conflictList(body.conflicts));
        setComments(commentList(body.comments));
        setOpen(true);
      })
      .catch(() => {
        if (!cancel) setOpen(false);
      });
    return () => {
      cancel = true;
    };
  }, [siteId, focus]);

  if (!open || !focus || !siteId) return null;
  return createPortal(
    <PnlOverlay
      statement={statement}
      conflicts={conflicts}
      comments={comments}
      siteId={siteId}
      focus={focus}
      onClose={() => { setOpen(false); setFocus(null); setSiteId(""); }}
    />,
    document.body,
  );
}
