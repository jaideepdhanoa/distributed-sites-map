export type ActionRole = "viewer" | "contributor" | "reviewer";

const ACTION_ROLES = new Set<ActionRole>(["viewer", "contributor", "reviewer"]);
const RANK: Record<ActionRole, number> = { viewer: 1, contributor: 2, reviewer: 3 };

export function isActionRole(value: unknown): value is ActionRole {
  return typeof value === "string" && ACTION_ROLES.has(value as ActionRole);
}

export type RoleSource = {
  role: string;
  roleLabel?: string | null;
  actionRole?: string | null;
};

/**
 * Role comes from the account record and ACTION_ROLE_MAP.
 * The map keys are role labels, never account names.
 */
export function loadRoleMap(): Record<string, ActionRole> {
  const map: Record<string, ActionRole> = { admin: "reviewer", user: "viewer" };
  const raw = process.env.ACTION_ROLE_MAP;
  if (!raw) return map;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return map;
    for (const [key, value] of Object.entries(parsed)) {
      const label = key.trim().toLowerCase();
      if (!label || label.length > 40 || !isActionRole(value)) continue;
      map[label] = value;
    }
  } catch {
    return { admin: "reviewer", user: "viewer" };
  }
  return map;
}

export function resolveActionRole(user: RoleSource): ActionRole {
  if (isActionRole(user.actionRole)) return user.actionRole;
  const label = String(user.roleLabel || user.role || "").trim().toLowerCase();
  if (isActionRole(label)) return label;
  return loadRoleMap()[label] || "viewer";
}

export function roleAllows(role: ActionRole, need: ActionRole): boolean {
  return RANK[role] >= RANK[need];
}

export function canWriteContent(role: ActionRole): boolean {
  return roleAllows(role, "contributor");
}

export function canDecide(role: ActionRole): boolean {
  return roleAllows(role, "reviewer");
}
