import { withoutGmail } from "@/lib/displayText";
import { LINE_LABELS, isPnlLineCode, type PnlLineCode } from "@/lib/pnl/lines";

/** Where a discussion thread is attached. One note row, shown in two places. */
export type CommentAnchorType = "pnl_cell" | "pnl_line" | "space";

export type CommentTag = "investigate" | "ask_broker" | "normalize" | "explained" | "verified";

export const COMMENT_TAGS: { id: CommentTag; label: string }[] = [
  { id: "investigate", label: "Investigate" },
  { id: "ask_broker", label: "Ask broker" },
  { id: "normalize", label: "Normalize" },
  { id: "explained", label: "Explained" },
  { id: "verified", label: "Verified" },
];

export type CommentAnchor = {
  type: CommentAnchorType;
  siteId: string;
  line: string;
  period: string;
  spaceId: string;
  label: string;
};

export type OpenPnlComment = {
  type: "pnl_cell" | "pnl_line";
  line: string;
  period: string;
};

const FORBIDDEN = [
  /ev[\s-]*charging/i,
  /\bavs\b/i,
  /autonomous vehicles/i,
  /walk[\s-]*away/i,
  /max(?:imum)?\s+price/i,
  /savings/i,
  /\boffers?\b/i,
];

export function commentTagLabel(tag: string): string {
  return COMMENT_TAGS.find((item) => item.id === tag)?.label || "";
}

export function isCommentTag(value: string): value is CommentTag {
  return COMMENT_TAGS.some((item) => item.id === value);
}

export function commentList(value: unknown): OpenPnlComment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as { type?: unknown; line?: unknown; period?: unknown };
    if ((row.type !== "pnl_cell" && row.type !== "pnl_line") || typeof row.line !== "string" || !row.line) return [];
    return [{ type: row.type, line: row.line, period: typeof row.period === "string" ? row.period : "" }];
  });
}

/** Year columns read as the year. Anything else stays as written. */
export function periodChip(period: string): string {
  const text = period.trim();
  if (!text) return "";
  const bare = /^(?:FY|year-)?(\d{4})$/.exec(text);
  if (bare) return bare[1];
  const full = /^(\d{4})-01-01\/\1-12-31$/.exec(text);
  if (full) return full[1];
  return text;
}

export function lineChip(line: string): string {
  if (isPnlLineCode(line)) return LINE_LABELS[line as PnlLineCode];
  return line.trim();
}

function cleanLabel(value: string, fallback: string): string {
  const text = withoutGmail(value).replace(/\s+/g, " ").trim();
  if (!text || FORBIDDEN.some((pattern) => pattern.test(text))) return fallback;
  return text;
}

/** Chip on the site discussion. The wording is the anchor, not the comment. */
export function chipLabel(anchor: CommentAnchor): string {
  if (anchor.type === "space") return `on lot, ${cleanLabel(anchor.label, "marked lot")}`;
  const line = cleanLabel(lineChip(anchor.line), "line");
  const period = periodChip(anchor.period);
  if (anchor.type === "pnl_cell" && period) return `on P&L, ${line} ${period}`;
  return `on P&L, ${line}`;
}

export function sameAnchor(left: CommentAnchor, right: CommentAnchor): boolean {
  if (left.type !== right.type || left.siteId !== right.siteId) return false;
  if (left.type === "space") return left.spaceId === right.spaceId && Boolean(left.spaceId);
  if (left.line !== right.line) return false;
  if (left.type === "pnl_line") return true;
  const leftPeriod = periodChip(left.period);
  const rightPeriod = periodChip(right.period);
  return left.period === right.period || (Boolean(leftPeriod) && leftPeriod === rightPeriod);
}

/**
 * A question for Jaideep to review. It is not sent.
 * The wording comes from the anchor, and the blocked list cannot appear in it.
 */
export function suggestBrokerQuestion(anchor: CommentAnchor): string {
  let text: string;
  if (anchor.type === "space") {
    const label = cleanLabel(anchor.label, "this marked area");
    text = label === "this marked area"
      ? "Could you describe how this marked area is used today?"
      : `Could you describe how ${label} is used today?`;
  } else {
    const line = cleanLabel(lineChip(anchor.line), "this line");
    const period = cleanLabel(periodChip(anchor.period), "");
    text = period
      ? `Could you confirm how ${line} was recorded for ${period}?`
      : `Could you confirm how ${line} was recorded?`;
  }
  if (FORBIDDEN.some((pattern) => pattern.test(text))) return "Could you confirm how this item was recorded?";
  return text;
}

export function brokerQuestionHasForbidden(text: string): boolean {
  return FORBIDDEN.some((pattern) => pattern.test(text));
}

export function focusYear(period: string): number | null {
  const match = /(\d{4})/.exec(period);
  if (!match) return null;
  const year = Number(match[1]);
  return year >= 1990 && year <= 2100 ? year : null;
}

export function focusMode(period: string): "years" | "months" {
  const text = period.trim();
  if (!text || /^\d{4}$/.test(text) || /^FY\d{4}$/.test(text) || /^\d{4}-01-01\/\d{4}-12-31$/.test(text)) return "years";
  return "months";
}
