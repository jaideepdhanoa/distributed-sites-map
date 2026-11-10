import { NETWORK_ANSWER, TIMEOUT_ANSWER } from "./empty";
import { isAbortError } from "./upstream";

/** The catch-all route allows 300s. Stop the model call before the platform does. */
export const ASK_UPSTREAM_TIMEOUT_MS = 270_000;
export const ASK_CLIENT_TIMEOUT_MS = 45_000;
export const ASK_STILL_WORKING_MS = 8_000;

export type AskTurn = {
  role: "user" | "ask";
  text: string;
  pending?: boolean;
  slow?: boolean;
  error?: boolean;
  linkRetry?: boolean;
  gap?: boolean;
};

export function beginAsk<T extends AskTurn>(turns: T[], question: string): T[] {
  return [
    ...turns,
    { role: "user", text: question } as T,
    { role: "ask", text: "", pending: true } as T,
  ];
}

export function markStillWorking<T extends AskTurn>(turns: T[]): T[] {
  const last = turns[turns.length - 1];
  if (!last?.pending) return turns;
  return [...turns.slice(0, -1), { ...last, slow: true }];
}

export function showAskText<T extends AskTurn>(turns: T[], text: string): T[] {
  const last = turns[turns.length - 1];
  if (last?.role !== "ask") return turns;
  return [...turns.slice(0, -1), { ...last, text, pending: true }];
}

export function finishAsk<T extends AskTurn>(turns: T[], result: Omit<T, "role" | "pending" | "slow">): T[] {
  const done = { role: "ask", pending: false, slow: false, ...result } as T;
  const last = turns[turns.length - 1];
  if (last?.role === "ask") return [...turns.slice(0, -1), done];
  return [...turns, done];
}

export function askFailure(error: unknown): { text: string; error: true; linkRetry: true } {
  if (isAbortError(error)) return { text: TIMEOUT_ANSWER, error: true, linkRetry: true };
  return { text: NETWORK_ANSWER, error: true, linkRetry: true };
}

/** Leave the typed question in place unless this send succeeded. */
export function composerAfter(sent: string, current: string, succeeded: boolean): string {
  if (!succeeded) return current;
  return current.trim() === sent.trim() ? "" : current;
}
