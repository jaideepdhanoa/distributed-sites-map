import { timingSafeEqual } from "node:crypto";

export type AgentCaller = { id: "muse" | "indie" | "shared"; canAck: boolean };

function bearerMatches(secret: string, header: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  if (expected.length !== actual.length) {
    timingSafeEqual(expected, expected);
    return false;
  }
  return timingSafeEqual(actual, expected);
}

/** Bearer check for agent reads. Muse, Indie, and the inbox secret are accepted. CRON_SECRET is not. */
export function authorizeAgent(request: Request): AgentCaller | null {
  const header = request.headers.get("authorization") || "";
  const muse = process.env.AGENT_WRITE_TOKEN_MUSE?.trim() || "";
  const indie = process.env.AGENT_WRITE_TOKEN_INDIE?.trim() || "";
  const shared = process.env.AGENT_INBOX_SECRET?.trim() || "";
  if (muse && bearerMatches(muse, header)) return { id: "muse", canAck: true };
  if (indie && bearerMatches(indie, header)) return { id: "indie", canAck: false };
  if (shared && bearerMatches(shared, header)) return { id: "shared", canAck: true };
  if (!muse && !indie && !shared) bearerMatches(" ", " ");
  return null;
}

/** Bearer check for the agent feed. CRON_SECRET is not accepted here. */
export function authorizeInbox(request: Request): boolean {
  return authorizeAgent(request) != null;
}
