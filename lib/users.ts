import { createHash } from "node:crypto";
import alertDefaults from "../config/alerts.json";

export type AuthUser = {
  u: string;
  h: string;
  role: "admin" | "user";
  roleLabel: string;
  actionRole: "viewer" | "contributor" | "reviewer" | null;
  displayName: string;
  email: string;
};

const ACTION = new Set(["viewer", "contributor", "reviewer"]);
const PROMOTED_ADMINS = new Set(
  (Array.isArray(alertDefaults.adminUsernames) ? alertDefaults.adminUsernames : [])
    .map((name) => String(name).trim().toLowerCase())
    .filter(Boolean),
);

function previewAdmin(username: string): boolean {
  if (process.env.VERCEL_ENV !== "preview") return false;
  const names = Array.isArray(alertDefaults.previewAdmins) ? alertDefaults.previewAdmins : [];
  return names.some((name) => String(name).trim().toLowerCase() === username);
}

function parseUsers(raw: string | undefined): AuthUser[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const users: AuthUser[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const u = String(row.u ?? row.username ?? "").trim().toLowerCase();
    const h = String(row.h ?? row.hash ?? row.passwordHash ?? "");
    const roleLabel = String(row.role ?? "user").trim().toLowerCase() || "user";
    const role = roleLabel === "admin" ? "admin" : "user";
    const explicit = String(row.actionRole ?? "").trim().toLowerCase();
    const actionRole = ACTION.has(explicit) ? (explicit as AuthUser["actionRole"]) : ACTION.has(roleLabel) ? (roleLabel as AuthUser["actionRole"]) : null;
    const named = String(row.name ?? row.displayName ?? "").trim();
    const displayName = named || u;
    const emailRaw = String(row.email ?? "").trim().toLowerCase();
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : "";
    const promoted = PROMOTED_ADMINS.has(u) || previewAdmin(u);
    const accountRole = promoted ? "admin" : role;
    const accountAction = promoted ? "reviewer" : actionRole;
    if (u && h.startsWith("$2")) users.push({ u, h, role: accountRole, roleLabel, actionRole: accountAction, displayName, email });
  }
  return users;
}

let teamLogKey = "";

/** Missing and invalid team lists are ignored. The value is never written to the log. */
function teamUsers(): AuthUser[] {
  const raw = process.env.AUTH_USERS_TEAM;
  const present = Boolean(raw && raw.trim());
  if (!present) {
    noteTeam("missing", "");
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw as string);
  } catch {
    noteTeam("invalid", raw as string);
    return [];
  }
  if (!Array.isArray(parsed)) {
    noteTeam("invalid", raw as string);
    return [];
  }
  return parseUsers(raw);
}

function noteTeam(reason: "missing" | "invalid", raw: string) {
  const key = `${reason}:${createHash("sha256").update(raw).digest("hex")}`;
  if (teamLogKey === key) return;
  teamLogKey = key;
  const line = JSON.stringify({ event: "auth_users_team_ignored", reason });
  if (reason === "invalid") console.error(line);
  else console.info(line);
}

export function getUsers(): AuthUser[] {
  const primary = parseUsers(process.env.AUTH_USERS);
  const seen = new Set(primary.map((user) => user.u));
  const team = teamUsers().filter((user) => !seen.has(user.u));
  return [...primary, ...team];
}
