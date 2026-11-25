/** Human-readable source of a work item. The link identifies the original evidence thread. */
export function gapReference(targetId: string, noteId: string) {
  return "Evidence gap: /?" + new URLSearchParams({ site: targetId, panel: "discussion", note: noteId });
}
