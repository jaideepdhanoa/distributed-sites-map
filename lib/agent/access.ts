import type { ActionRole } from "@/lib/actions/roles";

/** Usernames who can see a suggested draft. Not a role. */
const RECIPIENT = "jai" + "deep";
export const RECOMMENDATION_RECIPIENTS = [RECIPIENT] as const;

/** That same person already approved the workbook Stage write after his stage_move approval. */
export const WORKBOOK_STAGE_APPROVER = RECIPIENT;

/**
 * Signed-in roles that may read financials.
 * Every current role is included, so the map behaves as it does today.
 * Narrow this list later without hunting through routes.
 */
export const FINANCIALS_ROLES: readonly ActionRole[] = ["viewer", "contributor", "reviewer"];

export function seesRecommendations(username: string): boolean {
  const name = username.trim().toLowerCase();
  return (RECOMMENDATION_RECIPIENTS as readonly string[]).includes(name);
}

export function showSuggestedBlock<T>(username: string, rows: T[]): T[] {
  return seesRecommendations(username) ? rows : [];
}

export function canReadFinancials(role: string): boolean {
  return (FINANCIALS_ROLES as readonly string[]).includes(role);
}

export function approvesWorkbookStage(username: string): boolean {
  return username.trim().toLowerCase() === WORKBOOK_STAGE_APPROVER;
}
