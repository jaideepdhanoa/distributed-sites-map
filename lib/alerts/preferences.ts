import { resolveActionRole, type ActionRole } from "@/lib/actions/roles";
import type { Sql } from "@/lib/actions/db";
import { getUsers } from "@/lib/users";

export const ALERT_CATEGORIES = ["approvals", "mentions", "replies", "flags", "assignments"] as const;
export type AlertCategory = (typeof ALERT_CATEGORIES)[number];
export type AlertMode = "instant" | "digest" | "off";

export type AlertPreferences = Record<AlertCategory, AlertMode> & { followed: AlertMode };

const MODES = new Set<AlertMode>(["instant", "digest", "off"]);

export function defaultPreferences(role: ActionRole): AlertPreferences {
  if (role === "reviewer") {
    return {
      approvals: "instant",
      mentions: "instant",
      replies: "instant",
      flags: "instant",
      assignments: "instant",
      followed: "digest",
    };
  }
  if (role === "contributor") {
    return {
      approvals: "off",
      mentions: "instant",
      replies: "instant",
      flags: "instant",
      assignments: "instant",
      followed: "digest",
    };
  }
  return {
    approvals: "off",
    mentions: "instant",
    replies: "off",
    flags: "off",
    assignments: "off",
    followed: "off",
  };
}

export function preferencesForRole(username: string): AlertPreferences | null {
  const user = getUsers().find((item) => item.u === username.trim().toLowerCase());
  if (!user) return null;
  return defaultPreferences(resolveActionRole(user));
}

function mode(value: unknown, fallback: AlertMode): AlertMode {
  return typeof value === "string" && MODES.has(value as AlertMode) ? (value as AlertMode) : fallback;
}

export function parsePreferences(value: unknown, fallback: AlertPreferences): AlertPreferences {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    approvals: mode(row.approvals, fallback.approvals),
    mentions: mode(row.mentions, fallback.mentions),
    replies: mode(row.replies, fallback.replies),
    flags: mode(row.flags, fallback.flags),
    assignments: mode(row.assignments, fallback.assignments),
    followed: mode(row.followed, fallback.followed),
  };
}

type PrefRow = {
  approvals: string;
  mentions: string;
  replies: string;
  flags: string;
  assignments: string;
  followed: string;
};

export async function loadPreferences(sql: Sql, userId: string): Promise<AlertPreferences | null> {
  const base = preferencesForRole(userId);
  if (!base) return null;
  const rows = await sql.query<PrefRow>(
    `SELECT approvals, mentions, replies, flags, assignments, followed FROM alert_preferences WHERE user_id = $1`,
    [userId],
  );
  const stored = rows.rows[0];
  return stored ? parsePreferences(stored, base) : base;
}

export async function savePreferences(sql: Sql, userId: string, value: unknown): Promise<AlertPreferences | null> {
  const base = preferencesForRole(userId);
  if (!base) return null;
  const next = parsePreferences(value, base);
  await sql.query(
    `INSERT INTO alert_preferences (user_id, approvals, mentions, replies, flags, assignments, followed, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (user_id) DO UPDATE SET
       approvals = EXCLUDED.approvals,
       mentions = EXCLUDED.mentions,
       replies = EXCLUDED.replies,
       flags = EXCLUDED.flags,
       assignments = EXCLUDED.assignments,
       followed = EXCLUDED.followed,
       updated_at = now()`,
    [userId, next.approvals, next.mentions, next.replies, next.flags, next.assignments, next.followed],
  );
  return next;
}

export function digestEnabled(prefs: AlertPreferences): boolean {
  return prefs.followed === "digest" || prefs.followed === "instant";
}

/** A digest goes out only when a followed-site note, a digest item, or a waiting Review count exists. */
export function shouldSendDigest(input: { items: number; queueCount: number; digestOn: boolean }): boolean {
  if (input.items > 0) return true;
  return input.digestOn && input.queueCount > 0;
}
