"use client";

import { chipLabel, type CommentAnchor } from "@/lib/comments/anchor";
import { requestCommentAnchor } from "@/lib/comments/nav";

export default function CommentChip({ anchor }: { anchor: CommentAnchor }) {
  return (
    <button type="button" className="chip" data-testid="comment-chip" onClick={() => requestCommentAnchor(anchor)}>
      {chipLabel(anchor)}
    </button>
  );
}
