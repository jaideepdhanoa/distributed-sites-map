import type { CommentAnchor } from "./anchor";

export const COMMENT_OPEN = "open-comment-anchor";
export const COMMENT_CHANGED = "comment-threads-changed";

export function requestCommentAnchor(anchor: CommentAnchor): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(COMMENT_OPEN, { detail: anchor }));
}

export function notifyCommentChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(COMMENT_CHANGED));
}

export function readCommentAnchor(value: unknown): CommentAnchor | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<CommentAnchor>;
  if (row.type !== "pnl_cell" && row.type !== "pnl_line" && row.type !== "space") return null;
  if (!row.siteId) return null;
  return {
    type: row.type,
    siteId: String(row.siteId),
    line: String(row.line || ""),
    period: String(row.period || ""),
    spaceId: String(row.spaceId || ""),
    label: String(row.label || ""),
  };
}
