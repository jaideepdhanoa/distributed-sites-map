const HEX = "[0-9a-f]{16}";
const GMAIL_PAREN = new RegExp(`\\([^)]*\\b${HEX}\\b[^)]*\\)`, "gi");
const GMAIL_PHRASE = new RegExp(`\\bgmail(?:\\s+(?:message|id|thread))?\\s+${HEX}\\b`, "gi");
/** A 16-hex token. A Gmail inbox URL keeps its id; the link is the only allowed place. */
const BARE_HEX = new RegExp(`(?<![/#])\\b${HEX}\\b`, "gi");
const ID_KEYS = new Set(["messageid", "message_id", "threadid", "thread_id", "sourcelink", "source_link"]);

/**
 * Display-only. Drops a Gmail message id from prose: a parenthetical citation,
 * "Gmail message <16-hex>", or a bare 16-hex token. An inbox URL is left intact.
 * Stored workbook text is left as written.
 */
export function stripGmailIds(value: string): string {
  return String(value || "")
    .replace(GMAIL_PAREN, "")
    .replace(GMAIL_PHRASE, "Gmail")
    .replace(BARE_HEX, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/([,.;:]){2,}/g, "$1")
    .trim();
}

/** Client payloads drop Gmail ids from prose and from id fields. Inbox links stay. */
export function redactGmailPayload<T>(value: T): T {
  return walkGmail(value) as T;
}

function walkGmail(value: unknown, key = ""): unknown {
  if (typeof value === "string") {
    if (ID_KEYS.has(key.toLowerCase())) return "";
    if (!/[0-9a-f]{16}/i.test(value)) return value;
    return stripGmailIds(value);
  }
  if (Array.isArray(value)) return value.map((item) => walkGmail(item));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [name, item] of Object.entries(value)) out[name] = walkGmail(item, name);
    return out;
  }
  return value;
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
