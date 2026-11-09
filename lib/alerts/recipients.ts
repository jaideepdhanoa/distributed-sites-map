import { getUsers } from "@/lib/users";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function alertEmailMap(): Record<string, string> {
  const raw = process.env.ALERT_EMAILS;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const map: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const id = key.trim().toLowerCase();
      const email = String(value || "").trim().toLowerCase();
      if (id && EMAIL.test(email)) map[id] = email;
    }
    return map;
  } catch {
    return {};
  }
}

/** Mailbox for an app account. ALERT_EMAILS overrides the optional email on the account. */
export function accountEmail(username: string): string | null {
  const id = username.trim().toLowerCase();
  if (!id || !getUsers().some((user) => user.u === id)) return null;
  const email = alertEmailMap()[id] || getUsers().find((user) => user.u === id)?.email || "";
  return EMAIL.test(email) ? email : null;
}

export function deliveryRecipients(actorId: string, userIds: string[]): { userId: string; email: string }[] {
  const actor = actorId.trim().toLowerCase();
  const seen = new Set<string>();
  const out: { userId: string; email: string }[] = [];
  for (const raw of userIds) {
    const userId = raw.trim().toLowerCase();
    if (!userId || userId === actor || seen.has(userId)) continue;
    seen.add(userId);
    const email = accountEmail(userId);
    if (!email) continue;
    out.push({ userId, email });
  }
  return out;
}
