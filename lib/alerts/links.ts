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

/** Opens Discussion on one comment. Anchor fields from migration 022 stay on the link. */
export function commentHref(
  siteId: string,
  noteId: string,
  anchor?: { type?: string | null; line?: string | null; period?: string | null; spaceId?: string | null } | null,
): string {
  if (isExcludedSite(siteId)) return reviewHomeHref();
  if (/^NDA-\d{3,}$/.test(siteId)) {
    const url = new URL("/", appOrigin());
    url.searchParams.set("nda", "1");
    if (noteId) url.searchParams.set("note", noteId);
    return url.toString();
  }
  const url = new URL(discussionHref(siteId));
  if (noteId) url.searchParams.set("note", noteId);
  if (anchor?.type === "pnl_cell" || anchor?.type === "pnl_line") {
    if (anchor.line) url.searchParams.set("cline", anchor.line);
    if (anchor.type === "pnl_cell" && anchor.period) url.searchParams.set("cperiod", anchor.period);
  }
  if (anchor?.type === "space" && anchor.spaceId) url.searchParams.set("space", anchor.spaceId);
  return url.toString();
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

/** Opens the marked space on that site's aerial. The quarantined site never gets a link. */
export function spaceHref(siteId: string, spaceId: string): string {
  if (isExcludedSite(siteId) || !/^SS-\d{4,}$/.test(spaceId)) return reviewHomeHref();
  return `${appOrigin()}/?site=${encodeURIComponent(siteId)}&space=${encodeURIComponent(spaceId)}`;
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
  if (item.category === "stages" || item.category === "activity" || item.category === "comms" || item.category === "sites" || item.category === "asks") return siteHref(siteId);
  if (item.category === "decisions" && !proposalLink(item.href)) return siteHref(siteId);
  if (item.category === "approvals" || item.category === "assignments" || item.category === "proposals" || item.category === "decisions") {
    return proposalHref(siteId);
  }
  if ((item.category === "followed" || item.category === "recommendations") && proposalLink(item.href)) return proposalHref(siteId);
  const space = spaceIdFromHref(item.href);
  if (space && (item.category === "mentions" || item.category === "replies" || item.category === "comments" || item.category === "followed")) {
    return withNote(spaceHref(siteId, space), item.href);
  }
  if (item.category === "mentions" || item.category === "replies" || item.category === "comments" || item.category === "followed") {
    return keepCommentTarget(item.href, siteId);
  }
  return discussionHref(siteId);
}

function withNote(base: string, href: string | undefined): string {
  const url = new URL(base);
  if (!href) return url.toString();
  try {
    const source = new URL(href, "https://distributedsites.com");
    for (const key of ["note", "cline", "cperiod"]) {
      const value = source.searchParams.get(key);
      if (value) url.searchParams.set(key, value);
    }
  } catch {
    return url.toString();
  }
  return url.toString();
}

function keepCommentTarget(href: string | undefined, siteId: string): string {
  const base = discussionHref(siteId);
  if (!href) return base;
  try {
    const source = new URL(href, "https://distributedsites.com");
    const url = new URL(base);
    for (const key of ["note", "cline", "cperiod", "space"]) {
      const value = source.searchParams.get(key);
      if (value) url.searchParams.set(key, value);
    }
    return url.toString();
  } catch {
    return base;
  }
}

function spaceIdFromHref(href: string | undefined): string {
  if (!href) return "";
  try {
    const space = new URL(href, "https://distributedsites.com").searchParams.get("space") || "";
    return /^SS-\d{4,}$/.test(space) ? space : "";
  } catch {
    return "";
  }
}
