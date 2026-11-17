import { stripGmailIds } from "./displayText";

export type NoteBlock =
  | { kind: "p"; text: string }
  | { kind: "ol"; items: string[] };

const MARK = /(?:^|\s)(?:\(([0-9]{1,2}|[a-z])\)|([0-9]{1,2})[.)])(?=\s)/gi;
const SENTENCE = /[.!?]["')\]]*(?=\s+[A-Z])/g;
const ABBR = /(?:\b(?:Mr|Mrs|Ms|Dr|St|Ave|No|vs|etc|Jr|Sr|Inc|Ltd)|(?:^|\s)[A-Z]|e\.g|i\.e)\.$/i;

type Mark = { index: number; length: number; key: string };

/**
 * Display-only. Turns a note into paragraphs and ordered lists.
 * Stored text is not rewritten. Em dashes stay. Gmail ids are dropped.
 */
export function formatNoteBlocks(value: string): NoteBlock[] {
  const text = stripGmailIds(value).replace(/\s+/g, " ").trim();
  if (!text) return [];
  const listed = splitEnumeration(text);
  if (listed) {
    const blocks: NoteBlock[] = [];
    if (listed.preamble) blocks.push(...paragraphBlocks(listed.preamble));
    const { items, tail } = peelTail(listed.items);
    blocks.push({ kind: "ol", items });
    for (const part of tail) blocks.push({ kind: "p", text: part });
    return blocks;
  }
  return paragraphBlocks(text);
}

function marksIn(text: string): Mark[] {
  const out: Mark[] = [];
  for (const match of text.matchAll(MARK)) {
    const key = (match[1] || match[2] || "").toLowerCase();
    if (!key || match.index == null) continue;
    out.push({ index: match.index, length: match[0].length, key });
  }
  return out;
}

function sequence(keys: string[]): boolean {
  if (keys.length < 2) return false;
  if (keys.every((key) => /^\d+$/.test(key))) {
    const nums = keys.map(Number);
    if (nums[0] !== 1) return false;
    return nums.every((num, index) => index === 0 || num === nums[index - 1] + 1);
  }
  if (keys.every((key) => /^[a-z]$/.test(key))) {
    if (keys[0] !== "a") return false;
    return keys.every((key, index) => index === 0 || key.charCodeAt(0) === keys[index - 1].charCodeAt(0) + 1);
  }
  return false;
}

function splitEnumeration(text: string): { preamble: string; items: string[] } | null {
  const marks = marksIn(text);
  if (!sequence(marks.map((mark) => mark.key))) return null;
  const items: string[] = [];
  for (let index = 0; index < marks.length; index += 1) {
    const start = marks[index].index + marks[index].length;
    const end = index + 1 < marks.length ? marks[index + 1].index : text.length;
    const item = text.slice(start, end).replace(/[;\s]+$/g, "").trim();
    if (item.length < 8) return null;
    items.push(item);
  }
  const preamble = text.slice(0, marks[0].index).replace(/[:\s]+$/g, "").trim();
  return { preamble, items };
}

/** Extra sentences after the last enumerated item read as paragraphs, not as that item. */
function peelTail(items: string[]): { items: string[]; tail: string[] } {
  const last = items[items.length - 1] || "";
  const parts = splitObvious(last);
  if (parts.length < 2) return { items, tail: [] };
  return { items: [...items.slice(0, -1), parts[0]], tail: parts.slice(1) };
}

function paragraphBlocks(text: string): NoteBlock[] {
  const parts = splitObvious(text);
  if (parts.length <= 1) return [{ kind: "p", text }];
  return parts.map((part) => ({ kind: "p", text: part }));
}

function splitObvious(text: string): string[] {
  const sentences = splitSentences(text);
  const out: string[] = [];
  for (const sentence of sentences) out.push(...splitSemicolons(sentence));
  return out.length ? out : [text];
}

function splitSentences(text: string): string[] {
  if (text.length < 80) return [text];
  const parts: string[] = [];
  let start = 0;
  for (const match of text.matchAll(SENTENCE)) {
    if (match.index == null) continue;
    const end = match.index + match[0].length;
    const before = text.slice(Math.max(0, end - 8), end);
    if (ABBR.test(before)) continue;
    const chunk = text.slice(start, end).trim();
    const rest = text.slice(end).trim();
    if (chunk.length < 20 || rest.length < 12) continue;
    parts.push(chunk);
    start = end;
    while (text[start] === " ") start += 1;
  }
  const tail = text.slice(start).trim();
  if (tail) parts.push(tail);
  return parts.length > 1 ? parts : [text];
}

function splitSemicolons(text: string): string[] {
  const bits = text.split(/\s*;\s+/).map((bit) => bit.trim()).filter(Boolean);
  if (bits.length < 2 || bits.some((bit) => bit.length < 40)) return [text];
  return bits;
}
