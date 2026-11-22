import alertDefaults from "../../config/alerts.json";
import { liveMailAllowed } from "./transport";

export type DigestCadence = { daily: boolean; weekly: boolean };

function listed(names: unknown, userId: string): boolean {
  if (!Array.isArray(names)) return false;
  const id = userId.trim().toLowerCase();
  return names.some((item) => String(item || "").trim().toLowerCase() === id);
}

/** Ming is weekly only. Every other account still gets the morning digest. */
export function weeklyOnly(userId: string): boolean {
  return listed(alertDefaults.weeklyOnlyUsernames, userId);
}

/**
 * Live accounts get the Monday recap in addition to the daily digest.
 * weeklyOnlyUsernames skip the daily and keep the Monday recap.
 */
export function digestCadence(userId: string): DigestCadence {
  return {
    daily: !weeklyOnly(userId),
    weekly: liveMailAllowed(userId),
  };
}
