import { findPolicyHits, safeSnapshot } from "@/lib/policy/banned";
import { getUsers } from "@/lib/users";
import type { AlertCategory } from "./preferences";

export type MailItem = {
  category: AlertCategory | "followed" | "queue";
  siteId: string;
  siteLabel: string;
  summary: string;
  authorId: string;
  href: string;
};

const LABELS: Record<MailItem["category"], string> = {
  approvals: "Approval",
  mentions: "Mention",
  replies: "Reply",
  flags: "Flag",
  assignments: "Assignment",
  followed: "Note",
  queue: "Review",
};

export function categoryLabel(category: MailItem["category"]): string {
  return LABELS[category] || "Update";
}

export function authorName(id: string): string {
  const named = getUsers().find((user) => user.u === id)?.displayName || id;
  return safeSnapshot(named, 80) || id;
}

/** Short text for a mail body. Links and dollar figures stay out. */
export function publicSnippet(value: string): string {
  const stripped = String(value || "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\$\s?\d[\d,]*(?:\.\d+)?/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return safeSnapshot(stripped, 180);
}

export function screenEmail(subject: string, body: string): { subject: string; body: string } | null {
  let nextSubject = subject.trim();
  if (findPolicyHits(nextSubject)) nextSubject = "Review update";
  const lines = body.split("\n").filter((line) => line.trim() && !findPolicyHits(line));
  const nextBody = lines.join("\n").trim();
  if (!nextBody || findPolicyHits(nextSubject) || findPolicyHits(nextBody)) return null;
  return { subject: nextSubject, body: nextBody };
}

export function renderBatch(items: MailItem[]): { subject: string; body: string } | null {
  const blocks: string[] = [];
  for (const item of items) {
    if (item.category === "queue") {
      const line = publicSnippet(item.summary) || "Waiting in Review";
      blocks.push([line, item.href].filter(Boolean).join("\n"));
      continue;
    }
    const snippet = publicSnippet(item.summary);
    const lines = [item.siteLabel || item.siteId, categoryLabel(item.category)];
    if (snippet) lines.push(snippet);
    const author = authorName(item.authorId);
    if (author) lines.push(author);
    if (item.href) lines.push(item.href);
    blocks.push(lines.join("\n"));
  }
  if (!blocks.length) return null;
  const content = items.filter((item) => item.category !== "queue");
  const subject = content.length === 1
    ? `${categoryLabel(content[0].category)} · ${content[0].siteId}`
    : content.length === 0
      ? "Review queue"
      : `Review updates (${content.length})`;
  return screenEmail(subject, blocks.join("\n\n"));
}
