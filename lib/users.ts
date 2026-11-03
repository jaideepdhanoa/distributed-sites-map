export type AuthUser = { u: string; h: string; role: "admin" | "user" };

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
    const role = row.role === "admin" ? "admin" : "user";
    if (u && h.startsWith("$2")) users.push({ u, h, role });
  }
  return users;
}
