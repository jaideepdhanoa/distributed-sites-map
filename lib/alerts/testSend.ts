import { randomUUID } from "node:crypto";
import type { Sql } from "@/lib/actions/db";
import { stampOf } from "./clock";
import { deliverRows } from "./deliver";
import { reviewHomeHref } from "./links";
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

function sampleInstant(): MailItem {
  return {
    category: "approvals",
    siteId: "sample",
    siteLabel: "Sample site",
    summary: "This is a sample instant alert. Nothing on the map changed.",
    authorId: "sample",
    href: reviewHomeHref(),
  };
}

function sampleDigest(): MailItem[] {
  return [
    {
      category: "queue",
      siteId: "sample",
      siteLabel: "Sample site",
      summary: "A sample item is waiting in Review.",
      authorId: "sample",
      href: reviewHomeHref(),
    },
    {
      category: "followed",
      siteId: "sample",
      siteLabel: "Sample site",
      summary: "This is a sample note for the daily digest.",
      authorId: "sample",
      href: reviewHomeHref(),
    },
  ];
}

export function testAlertMessage(delivery: TestAlertResult["delivery"], email: string, live: boolean): string {
  if (delivery === "sent") return `Sent a sample instant alert and a sample daily digest to ${email}.`;
  if (delivery === "capped") return "The daily send cap was reached, so the sample alerts were not mailed.";
  if (delivery === "would_send" && !live) {
    return `Nothing was mailed to ${email}. A sample instant alert and a sample daily digest were written to the would-send log, because this account is not approved for live mail.`;
  }
  if (delivery === "would_send") {
    return `Nothing was mailed to ${email}. A sample instant alert and a sample daily digest were written to the would-send log, because mail is not configured.`;
  }
  return "The sample alerts could not be mailed.";
}

function combined(instant: string, digest: string): TestAlertResult["delivery"] {
  if (instant === "error" || digest === "error") return "error";
  if (instant === "capped" || digest === "capped") return "capped";
  if (instant === "would_send" || digest === "would_send") return "would_send";
  if (instant === "skipped" || digest === "skipped") return "skipped";
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
  const instant = await deliverRows(sql, {
    userId: input.userId,
    email,
    rows: [],
    extra: [sampleInstant()],
    key: `test:instant:${input.userId}:${nonce}`,
    now,
    subjectPrefix: TEST_SUBJECT_PREFIX,
  });
  const digest = await deliverRows(sql, {
    userId: input.userId,
    email,
    rows: [],
    extra: sampleDigest(),
    key: `test:digest:${input.userId}:${nonce}`,
    now,
    subjectPrefix: TEST_SUBJECT_PREFIX,
  });
  const delivery = combined(instant, digest);
  return { limited: false, delivery, email, instant, digest, message: testAlertMessage(delivery, email, live) };
}
