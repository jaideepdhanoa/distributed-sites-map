import { timingSafeEqual } from "node:crypto";

/** Bearer check for the agent feed. CRON_SECRET is not accepted here. */
export function authorizeInbox(request: Request): boolean {
  const secret = process.env.AGENT_INBOX_SECRET?.trim() || "";
  if (!secret) return false;
  const header = request.headers.get("authorization") || "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  if (expected.length !== actual.length) {
    timingSafeEqual(expected, expected);
    return false;
  }
  return timingSafeEqual(actual, expected);
}
