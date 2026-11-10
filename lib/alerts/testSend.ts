import { randomUUID } from "node:crypto";
import type { Sql } from "@/lib/actions/db";
import { stampOf } from "./clock";
import { deliverRows } from "./deliver";
import { discussionHref, proposalHref, reviewHomeHref, reviewHref } from "./links";
import { liveMailAllowed } from "./transport";
import type { MailItem } from "./compose";

export const TEST_WINDOW_MS = 5 * 60 * 1000;
export const TEST_SUBJECT_PREFIX = "[Test]";

export type TestAlertResult = {
  limited: boolean;
  delivery: "sent" | "would_send" | "capped" | "error" | "skipped";
  email: string;
  instant: string;
  digest: string;
  message: string;
};

const SAMPLE_NOTES: Record<MailItem["category"], string> = {
  approvals: "Please review the next step on this sample site.",
  mentions: "Please take a look at this sample note.",
  replies: "Adding a sample reply on the thread.",
  flags: "Flagging this sample site for a closer look.",
  assignments: "This sample site is assigned to you.",
  followed: "This is a sample note for the daily digest.",
  queue: "A sample item is waiting in Review.",
};

function sampleHref(category: MailItem["category"]): string {
  if (category === "approvals" || category === "assignments") return proposalHref("sample");
  if (category === "flags") return reviewHref("sample");
  if (category === "queue") return reviewHomeHref();
  return discussionHref("sample");
}

function sampleItem(category: MailItem["category"]): MailItem {
  return {
    category,
    siteId: "sample",
    siteLabel: "Sample site",
    summary: SAMPLE_NOTES[category],
    authorId: "Ana",
    href: sampleHref(category),
    market: "PHX",
    stage: "Desk screen",
  };
}

function sampleInstants(): MailItem[] {
  return (["approvals", "mentions", "replies", "flags", "assignments"] as const).map(sampleItem);
}

function sampleDigest(): MailItem[] {
  return sampleInstants();
}

export function testAlertMessage(delivery: TestAlertResult["delivery"], email: string, live: boolean): string {
  if (delivery === "sent") return `Sent a sample of each alert and a daily digest to ${email}.`;
  if (delivery === "capped") return "The daily send cap was reached, so the sample alerts were not mailed.";
  if (delivery === "would_send" && !live) {
    return `Nothing was mailed to ${email}. A sample of each alert and a daily digest were written to the would-send log, because this account is not approved for live mail.`;
  }
  if (delivery === "would_send") {
    return `Nothing was mailed to ${email}. A sample of each alert and a daily digest were written to the would-send log, because mail is not configured.`;
  }
  return "The sample alerts could not be mailed.";
}

function combined(statuses: string[]): TestAlertResult["delivery"] {
  if (statuses.some((status) => status === "error")) return "error";
  if (statuses.some((status) => status === "capped")) return "capped";
  if (statuses.some((status) => status === "would_send")) return "would_send";
  if (statuses.some((status) => status === "skipped")) return "skipped";
  return "sent";
}

async function recentlyTested(sql: Sql, userId: string, now: Date): Promise<boolean> {
  const rows = await sql.query<{ created_at: Date | string }>(
    `SELECT created_at FROM alert_log
     WHERE user_id = $1 AND idempotency_key LIKE 'test:%'
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId],
  );
  const created = rows.rows[0]?.created_at;
  if (!created) return false;
  return now.getTime() - stampOf(created) < TEST_WINDOW_MS;
}

/** One sample instant alert and one sample digest, only to this account. */
export async function sendTestAlerts(sql: Sql, input: { userId: string; email: string; now?: Date }): Promise<TestAlertResult> {
  const now = input.now || new Date();
  const email = input.email.trim().toLowerCase();
  const live = liveMailAllowed(input.userId);
  if (await recentlyTested(sql, input.userId, now)) {
    return {
      limited: true,
      delivery: "skipped",
      email,
      instant: "skipped",
      digest: "skipped",
      message: "A test alert was just sent. Wait five minutes and try again.",
    };
  }
  const nonce = `${now.getTime()}-${randomUUID()}`;
  const statuses: string[] = [];
  for (const item of sampleInstants()) {
    statuses.push(await deliverRows(sql, {
      userId: input.userId,
      email,
      rows: [],
      extra: [item],
      key: `test:instant:${item.category}:${input.userId}:${nonce}`,
      now,
      subjectPrefix: TEST_SUBJECT_PREFIX,
      kind: "instant",
    }));
  }
  const digest = await deliverRows(sql, {
    userId: input.userId,
    email,
    rows: [],
    extra: sampleDigest(),
    key: `test:digest:${input.userId}:${nonce}`,
    now,
    subjectPrefix: TEST_SUBJECT_PREFIX,
    kind: "digest",
  });
  statuses.push(digest);
  const delivery = combined(statuses);
  return { limited: false, delivery, email, instant: statuses[0] || "skipped", digest, message: testAlertMessage(delivery, email, live) };
}
