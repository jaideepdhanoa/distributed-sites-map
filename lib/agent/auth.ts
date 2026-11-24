import { timingSafeEqual } from "node:crypto";
import { WRITE_AGENTS, canCapture, type WriteAgent } from "./identity";

export type AgentCaller = { id: WriteAgent | "shared"; canAck: boolean };

const TOKEN_ENV: Record<WriteAgent, string> = {
  indie: "AGENT_WRITE_TOKEN_INDIE",
  muse: "AGENT_WRITE_TOKEN_MUSE",
  chatgpt: "AGENT_WRITE_TOKEN_CHATGPT",
};

function bearerMatches(secret: string, header: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  if (expected.length !== actual.length) {
    timingSafeEqual(expected, expected);
    return false;
  }
  return timingSafeEqual(actual, expected);
}

export function agentFromAuthorization(header: string): { id: WriteAgent; kind: "agent" } | "missing-env" | "nomatch" | "absent" {
  const value = header.trim();
  if (!value) return "absent";
  if (!value.toLowerCase().startsWith("bearer ")) return "nomatch";
  const configured = WRITE_AGENTS.filter((id) => process.env[TOKEN_ENV[id]]?.trim());
  if (!configured.length) return "missing-env";
  const matches = configured.filter((id) => bearerMatches(process.env[TOKEN_ENV[id]]!.trim(), value));
  return matches.length === 1 ? { id: matches[0], kind: "agent" } : "nomatch";
}

/** The shared inbox credential is accepted only on feed routes. */
export function authorizeAgent(request: Request): AgentCaller | null {
  const header = request.headers.get("authorization") || "";
  const agent = agentFromAuthorization(header);
  if (typeof agent === "object") return { id: agent.id, canAck: canCapture(agent.id) };
  const shared = process.env.AGENT_INBOX_SECRET?.trim();
  if (shared && bearerMatches(shared, header)) return { id: "shared", canAck: true };
  return null;
}

export function authorizeInbox(request: Request): boolean {
  return authorizeAgent(request) != null;
}
