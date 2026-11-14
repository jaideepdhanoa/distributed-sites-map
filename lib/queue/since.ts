import { stageDetail } from "@/lib/labels";
import { stageKey } from "@/lib/stageOverlay";
import type { QueueReason } from "./order";

export type SinceLine = { text: string; at: string; when: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function reviewWhen(at: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(at);
  if (match) {
    const month = MONTHS[Number(match[2]) - 1];
    if (month) return `${month} ${Number(match[3])}`;
  }
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) return at;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" }).format(parsed);
}

function stagePhrase(summary: string): string {
  const raw = summary.replace(/^Stage is now\s+/i, "").replace(/\.$/, "").trim();
  const group = stageKey(raw);
  const label = group ? stageDetail(raw, group) : raw;
  return `stage moved to ${label || "the next stage"}`;
}

function clause(type: string, count: number, sample: string): string {
  if (type === "stage") return stagePhrase(sample);
  if (type === "note" || type === "reply") return count === 1 ? "1 new note" : `${count} new notes`;
  if (type === "new_site") return count === 1 ? "new site" : `${count} new sites`;
  if (type === "price") return count === 1 ? "price changed" : `${count} price changes`;
  if (type === "verdict") return count === 1 ? "verdict changed" : `${count} verdict changes`;
  if (type === "activity") return count === 1 ? "new activity" : `${count} activity updates`;
  if (type === "materials") return count === 1 ? "new materials" : `${count} material updates`;
  if (type === "mention") return count === 1 ? "mentioned you" : `${count} mentions`;
  if (type === "flag") return count === 1 ? "flagged for you" : `${count} flags`;
  if (type === "assignment" || type === "next_proposed" || type === "next_accepted") {
    return count === 1 ? "assigned" : `${count} assignments`;
  }
  if (type === "document_request") return count === 1 ? "needs approval" : `${count} approvals`;
  if (type === "drop") return count === 1 ? "dropped" : `${count} drops`;
  if (type === "drop_suggested") return count === 1 ? "suggested drop" : `${count} suggested drops`;
  if (type === "bring_back") return count === 1 ? "brought back" : `${count} bring-backs`;
  const clean = sample.replace(/\.$/, "").trim();
  return count === 1 ? clean || "update" : `${count} updates`;
}

function grouped(reasons: QueueReason[]): { type: string; count: number; sample: string }[] {
  const order: string[] = [];
  const buckets = new Map<string, { type: string; count: number; sample: string }>();
  for (const reason of reasons) {
    const type = reason.type === "reply" ? "note" : reason.type;
    const current = buckets.get(type);
    if (!current) {
      order.push(type);
      buckets.set(type, { type, count: 1, sample: reason.summary });
      continue;
    }
    current.count += 1;
  }
  const rank = (type: string) => (type === "stage" ? 0 : type === "note" ? 1 : 2);
  return order
    .map((type) => buckets.get(type)!)
    .sort((a, b) => rank(a.type) - rank(b.type));
}

export function reviewSentence(input: {
  firstVisit: boolean;
  reviewedAt?: string | null;
  reasons: QueueReason[];
}): { sentence: string; lines: SinceLine[] } {
  const lines = input.reasons.map((reason) => ({
    text: reason.summary.replace(/\.$/, ""),
    at: reason.at,
    when: reviewWhen(reason.at),
  }));
  if (input.firstVisit) return { sentence: "First time in your review", lines };
  const clauses = grouped(input.reasons);
  const since = reviewWhen(input.reviewedAt || input.reasons[0]?.at || "");
  if (!clauses.length) return { sentence: since ? `Since ${since}: no new changes` : "No new changes", lines };
  const shown = clauses.slice(0, 2).map((item) => clause(item.type, item.count, item.sample));
  const rest = clauses.length - shown.length;
  const body = rest > 0 ? [...shown, `+${rest} more`] : shown;
  return { sentence: `Since ${since}: ${body.join(" · ")}`, lines };
}
