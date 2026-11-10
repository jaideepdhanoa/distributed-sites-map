import { findPolicyHits, safeSnapshot } from "@/lib/policy/banned";
import { getUsers } from "@/lib/users";
import { renderAlert } from "./template";
import type { AlertCategory } from "./preferences";

export type MailItem = {
  category: AlertCategory | "followed" | "queue";
  siteId: string;
  siteLabel: string;
  summary: string;
  authorId: string;
  href: string;
  market?: string;
  stage?: string;
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

export function renderBatch(items: MailItem[], options?: { now?: Date; kind?: "instant" | "digest" }): { subject: string; body: string; html: string } | null {
  return renderAlert(items, options);
}
