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

export function getUsers(): AuthUser[] {
  const raw = process.env.AUTH_USERS;
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
    if (u && h.startsWith("$2")) users.push({ u, h, role, roleLabel, actionRole, displayName, email });
  }
  return users;
}
