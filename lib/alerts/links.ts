import { absoluteSiteUrl } from "@/lib/agent/links";
import { isExcludedSite } from "./excluded";

const PRODUCTION_ORIGIN = "https://distributedsites.com";

/**
 * Host for links in mail. APP_URL wins when it is not a preview host.
 * Otherwise the production domain. Request hosts and Vercel preview URLs are never used.
 */
export function appOrigin(): string {
  const explicit = (process.env.APP_URL || "").trim().replace(/\/$/, "");
  if (explicit && !previewOrigin(explicit)) return explicit;
  return PRODUCTION_ORIGIN;
}

function previewOrigin(value: string): boolean {
  let host = "";
  try {
    host = new URL(value).hostname.toLowerCase();
  } catch {
    return true;
  }
  if (host === "preview.distributedsites.com") return true;
  if (host.endsWith(".vercel.app")) return true;
  if (host.split(".")[0] === "preview") return true;
  return false;
}

export function discussionHref(siteId: string): string {
  return absoluteSiteUrl(appOrigin(), "note", siteId);
}

export function proposalHref(siteId: string): string {
  return absoluteSiteUrl(appOrigin(), "suggestion", siteId);
}

export function reviewHref(siteId: string): string {
  return absoluteSiteUrl(appOrigin(), "flag", siteId);
}

export function homeHref(): string {
  return absoluteSiteUrl(appOrigin(), "ask_gap", "portfolio");
}

export function reviewHomeHref(): string {
  return `${appOrigin()}/?view=review`;
}

/** Opens the site on the map. The quarantined site never gets a link. */
export function siteHref(siteId: string): string {
  if (isExcludedSite(siteId)) return reviewHomeHref();
  return absoluteSiteUrl(appOrigin(), "ask_gap", siteId);
}

export function settingsHref(): string {
  return `${appOrigin()}/?alerts=1`;
}

type MailLink = { category: string; siteId: string; href?: string };

/** The same absolute site link the agent feed uses, always on the production host. */
function proposalLink(href: string | undefined): boolean {
  return Boolean(href && /[?&]panel=proposal(?:&|$)/.test(href));
}

export function mailLink(item: MailLink): string {
  const siteId = item.siteId.trim();
  if (item.category === "queue" || item.category === "brief" || !siteId) return reviewHomeHref();
  if (isExcludedSite(siteId)) return reviewHomeHref();
  if (siteId === "portfolio") return homeHref();
  if (item.category === "flags") return reviewHref(siteId);
  if (item.category === "stages" || item.category === "activity" || item.category === "comms") return siteHref(siteId);
  if (item.category === "decisions" && !proposalLink(item.href)) return siteHref(siteId);
  if (item.category === "approvals" || item.category === "assignments" || item.category === "proposals" || item.category === "decisions") {
    return proposalHref(siteId);
  }
  if ((item.category === "followed" || item.category === "recommendations") && proposalLink(item.href)) return proposalHref(siteId);
  return discussionHref(siteId);
}
