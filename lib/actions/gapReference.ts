/** Human-readable source of a work item. The link identifies the original evidence thread. */
export function gapReference(targetId: string, noteId: string) {
  return "Evidence gap: /?" + new URLSearchParams({ site: targetId, panel: "discussion", note: noteId });
}

export function gapNoteId(targetId: string, reference: string) {
  const note = reference.match(/&note=([a-f0-9-]{36})$/i)?.[1];
  return note && reference === gapReference(targetId, note) ? note : null;
}
