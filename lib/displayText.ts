const GMAIL_PAREN = /\(\s*gmail\s+[0-9a-f]{16}\s*\)/gi;
const GMAIL_BARE = /\bgmail\s+([0-9a-f]{16})\b/gi;

/**
 * Display-only. Drops a parenthesized "Gmail <16-hex>" citation and a bare
 * 16-hex id that follows the word Gmail. Stored workbook text is left as written.
 */
export function stripGmailIds(value: string): string {
  return String(value || "")
    .replace(GMAIL_PAREN, "")
    .replace(GMAIL_BARE, "Gmail")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/([,.;:]){2,}/g, "$1")
    .trim();
}

/** Cut on a word boundary and leave an ellipsis when the text is longer. */
export function previewAtWord(value: string, limit = 140): { preview: string; full: string; clipped: boolean } {
  const full = String(value || "").replace(/\s+/g, " ").trim();
  if (!full || full.length <= limit) return { preview: full, full, clipped: false };
  const slice = full.slice(0, limit);
  const cut = slice.replace(/\s+\S*$/, "").trim();
  const preview = `${cut || slice.trim()}…`;
  return { preview, full, clipped: preview !== full };
}
