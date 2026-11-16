/** Assignee or admin. Safe for the client bundle: no database imports. */
export function canCloseProposal(input: { actorId: string; ownerId: string | null; admin: boolean }): boolean {
  const actor = input.actorId.trim();
  if (!actor) return false;
  if (input.admin) return true;
  const owner = (input.ownerId || "").trim();
  return Boolean(owner) && owner === actor;
}
