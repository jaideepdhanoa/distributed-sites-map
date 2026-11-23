const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const DATE = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\s+\\d{1,2}(?:,\\s*\\d{4})?";

function parenDepth(text: string, index: number): number {
  let depth = 0;
  for (let i = 0; i < index; i += 1) {
    const char = text[i];
    if (char === "(") depth += 1;
    else if (char === ")" && depth > 0) depth -= 1;
  }
  return depth;
}

/** A date starts an entry at the start of the text or after a sentence end, semicolon, or newline. */
function boundaryBefore(text: string, index: number): boolean {
  const before = text.slice(0, index).replace(/[ \t]+$/g, "");
  if (!before) return true;
  const last = before[before.length - 1];
  return last === "\n" || last === ";" || last === "." || last === "!" || last === "?";
}

function lineStart(text: string, index: number): boolean {
  const before = text.slice(0, index).replace(/[ \t]+$/g, "");
  return !before || before.endsWith("\n");
}

/** A colon, or a dash with space on both sides. A glued range such as Oct 29-30 is not a split. */
function separatorAfter(text: string, index: number): boolean {
  const rest = text.slice(index);
  if (/^\s*:/.test(rest)) return true;
  return /^\s+[–—-]\s+\S/.test(rest);
}

function impliedYear(text: string): number {
  const years = [...text.matchAll(/\b(19|20)\d{2}\b/g)].map((match) => Number(match[0]));
  return years.length ? Math.max(...years) : 0;
}

function dateStamp(date: string, yearFallback: number): number {
  const match = /([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?/.exec(date);
  if (!match) return 0;
  const month = MONTHS[match[1].slice(0, 3).toLowerCase()] || 0;
  const day = Number(match[2]);
  const year = match[3] ? Number(match[3]) : yearFallback;
  return year * 10000 + month * 100 + day;
}

function clockAfter(text: string, index: number): number {
  const match = /^,\s*(\d{1,2}):(\d{2})/.exec(text.slice(index));
  if (!match) return 0;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return 0;
  return hour * 100 + minute;
}

/**
 * Dated register notes, newest first.
 * A date splits an entry when it starts a line, or when it follows a sentence
 * end or semicolon and is then followed by ":" or a spaced dash.
 * A line that starts "Nov 18, 2026, 17:26 PT" is its own entry.
 * Dates inside parentheses or mid-sentence stay in the paragraph. With no
 * confident split the text is returned unchanged, including its line breaks.
 */
export function noteEntries(notes: string): string[] {
  const text = notes.replace(/\r\n/g, "\n");
  if (!text.trim()) return [];
  const starts: { index: number; date: string }[] = [];
  const re = new RegExp(DATE, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const index = match.index;
    if (parenDepth(text, index) > 0) continue;
    const atLine = lineStart(text, index);
    if (!atLine && !boundaryBefore(text, index)) continue;
    if (!atLine && !separatorAfter(text, index + match[0].length)) continue;
    starts.push({ index, date: match[0] });
  }
  if (!starts.length) return [text];
  const year = impliedYear(text);
  const parts: { text: string; stamp: number }[] = [];
  const head = text.slice(0, starts[0].index).trim();
  if (head) parts.push({ text: head, stamp: Number.NEGATIVE_INFINITY });
  for (let i = 0; i < starts.length; i += 1) {
    const end = i + 1 < starts.length ? starts[i + 1].index : text.length;
    const body = text.slice(starts[i].index, end).trim();
    if (!body) continue;
    const stamp = dateStamp(starts[i].date, year) * 10000 + clockAfter(text, starts[i].index + starts[i].date.length);
    parts.push({ text: body, stamp });
  }
  return parts.sort((left, right) => right.stamp - left.stamp).map((part) => part.text);
}
