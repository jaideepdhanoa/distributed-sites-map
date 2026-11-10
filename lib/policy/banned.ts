export const POLICY_MESSAGE = "That text is not allowed on the map. Rephrase it and try again.";

const PHONE = /(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\b\d{3})[-.\s]\d{3}[-.\s]\d{4}\b/;

/** The map is private to the signed-in team, so display terms are not checked. A phone number still is. */
export function findPolicyHits(text: string): number {
  return PHONE.test(text || "") ? 1 : 0;
}

export class PolicyError extends Error {
  readonly code = "banned_term";
  constructor() {
    super(POLICY_MESSAGE);
  }
}

export function assertClean(text: string): void {
  if (findPolicyHits(text)) throw new PolicyError();
}

/** Keep a stored snapshot. A phone number is still left off the screen. */
export function safeSnapshot(value: unknown, max = 2000): string {
  const text = String(value ?? "").trim().slice(0, max);
  if (!text || findPolicyHits(text)) return "";
  return text;
}
