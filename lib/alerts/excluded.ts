/** Quarantined site. Mail never names it or links to it. */
export const EXCLUDED_SITE_ID = "PIPE-PHX-0006";

export function isExcludedSite(siteId: string | null | undefined): boolean {
  return String(siteId || "").trim().toUpperCase() === EXCLUDED_SITE_ID;
}
