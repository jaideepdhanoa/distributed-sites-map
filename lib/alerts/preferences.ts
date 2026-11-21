import { resolveActionRole, type ActionRole } from "@/lib/actions/roles";
import type { Sql } from "@/lib/actions/db";
import { getUsers } from "@/lib/users";
import { isOwnerAccount } from "./owner";

export const ALERT_CATEGORIES = [
  "approvals",
  "mentions",
  "comments",
  "replies",
  "flags",
  "assignments",
  "recommendations",
  "proposals",
  "decisions",
  "stages",
  "asks",
] as const;
export type AlertCategory = (typeof ALERT_CATEGORIES)[number];
export type AlertMode = "instant" | "digest" | "off";

export type AlertPreferences = Record<AlertCategory, AlertMode> & { followed: AlertMode; followAll: boolean };

const PREFERENCE_FIELDS = [
  ...ALERT_CATEGORIES.map((key) => ({ column: key, key })),
  { column: "followed", key: "followed" as const },
  { column: "follow_all", key: "followAll" as const },
];

const MODES = new Set<AlertMode>(["instant", "digest", "off"]);

export function defaultPreferences(role: ActionRole): AlertPreferences {
  if (role === "reviewer") {
    return {
      approvals: "instant",
      mentions: "instant",
      comments: "instant",
      replies: "instant",
      flags: "instant",
      assignments: "instant",
      recommendations: "digest",
      proposals: "instant",
      decisions: "instant",
      stages: "digest",
      asks: "digest",
      followed: "digest",
      followAll: false,
    };
  }
  if (role === "contributor") {
    return {
      approvals: "off",
      mentions: "instant",
      comments: "digest",
      replies: "digest",
      flags: "instant",
      assignments: "instant",
      recommendations: "digest",
      proposals: "digest",
      decisions: "digest",
      stages: "digest",
      asks: "digest",
      followed: "digest",
      followAll: false,
    };
  }
  return {
    approvals: "off",
    mentions: "instant",
    comments: "off",
    replies: "off",
    flags: "off",
    assignments: "off",
    recommendations: "off",
    proposals: "off",
    decisions: "off",
    stages: "off",
    asks: "off",
    followed: "off",
    followAll: false,
  };
}

export function preferencesForRole(username: string): AlertPreferences | null {
  const user = getUsers().find((item) => item.u === username.trim().toLowerCase());
  if (!user) return null;
  const prefs = defaultPreferences(resolveActionRole(user));
  if (isOwnerAccount(user.u)) prefs.followAll = true;
  return prefs;
}

function mode(value: unknown, fallback: AlertMode): AlertMode {
  return typeof value === "string" && MODES.has(value as AlertMode) ? (value as AlertMode) : fallback;
}

function followAllFlag(value: unknown, fallback: boolean): boolean {
  if (value === true || value === "on") return true;
  if (value === false || value === "off") return false;
  return fallback;
}

export function parsePreferences(value: unknown, fallback: AlertPreferences): AlertPreferences {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    approvals: mode(row.approvals, fallback.approvals),
    mentions: mode(row.mentions, fallback.mentions),
    comments: mode(row.comments, fallback.comments),
    replies: mode(row.replies, fallback.replies),
    flags: mode(row.flags, fallback.flags),
    assignments: mode(row.assignments, fallback.assignments),
    recommendations: mode(row.recommendations, fallback.recommendations),
    proposals: mode(row.proposals, fallback.proposals),
    decisions: mode(row.decisions, fallback.decisions),
    stages: mode(row.stages, fallback.stages),
    asks: mode(row.asks, fallback.asks),
    followed: mode(row.followed, fallback.followed),
    followAll: followAllFlag(row.follow_all ?? row.followAll, fallback.followAll),
  };
}

async function storedColumns(sql: Sql): Promise<Set<string>> {
  const rows = await sql.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'alert_preferences'`,
  );
  return new Set(rows.rows.map((row) => row.column_name));
}

export async function loadPreferences(sql: Sql, userId: string): Promise<AlertPreferences | null> {
  const base = preferencesForRole(userId);
  if (!base) return null;
  const rows = await sql.query<Record<string, unknown>>(
    `SELECT * FROM alert_preferences WHERE user_id = $1`,
    [userId],
  );
  const stored = rows.rows[0];
  const prefs = stored ? parsePreferences(stored, base) : base;
  if (!isOwnerAccount(userId)) prefs.followAll = false;
  return prefs;
}

export async function savePreferences(sql: Sql, userId: string, value: unknown): Promise<AlertPreferences | null> {
  const base = preferencesForRole(userId);
  if (!base) return null;
  const next = parsePreferences(value, base);
  if (!isOwnerAccount(userId)) next.followAll = false;
  const have = await storedColumns(sql);
  const fields = PREFERENCE_FIELDS.filter((field) => have.has(field.column));
  const columns = ["user_id", ...fields.map((field) => field.column), "updated_at"];
  const values: unknown[] = [userId, ...fields.map((field) => field.key === "followAll" ? (next.followAll ? "on" : "off") : next[field.key])];
  const marks = values.map((_, index) => `$${index + 1}`);
  marks.push("now()");
  const assignments = fields.map((field) => `${field.column} = EXCLUDED.${field.column}`);
  assignments.push("updated_at = now()");
  await sql.query(
    `INSERT INTO alert_preferences (${columns.join(", ")})
     VALUES (${marks.join(", ")})
     ON CONFLICT (user_id) DO UPDATE SET ${assignments.join(", ")}`,
    values,
  );
  return next;
}

export function digestEnabled(prefs: AlertPreferences): boolean {
  return prefs.followed === "digest" || prefs.followed === "instant";
}

/** A digest goes out only when something new is waiting, or Review still has items and the digest is on. */
export function shouldSendDigest(input: { items: number; queueCount: number; digestOn: boolean }): boolean {
  if (input.items > 0) return true;
  return input.digestOn && input.queueCount > 0;
}
