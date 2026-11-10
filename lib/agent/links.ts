const PRODUCTION_ORIGIN = "https://distributedsites.com";

type FeedKind = "note" | "reply" | "mention" | "suggestion" | "flag" | "decision" | "ask_gap";

/** APP_URL when set, otherwise the production map. No trailing slash. */
export function configuredOrigin(): string {
  const explicit = (process.env.APP_URL || "").trim().replace(/\/$/, "");
  return explicit || PRODUCTION_ORIGIN;
}

function firstHeader(request: Request, name: string): string {
  return (request.headers.get(name) || "").split(",")[0].trim();
}

/**
 * Origin for a feed link. The request host wins so a preview call stays on
 * that host. APP_URL, then https://distributedsites.com, is the fallback.
 */
export function feedOrigin(request?: Request): string {
  if (request) {
    const url = new URL(request.url);
    const host = firstHeader(request, "x-forwarded-host") || firstHeader(request, "host") || url.host;
    if (host) {
      const proto = firstHeader(request, "x-forwarded-proto") || url.protocol.replace(":", "") || "https";
      return `${proto}://${host}`.replace(/\/$/, "");
    }
  }
  return configuredOrigin();
}

/** Map path for one feed row. Portfolio is the home map. */
export function feedSitePath(kind: FeedKind, siteId: string): string {
  if (!siteId || siteId === "portfolio") return "/";
  const site = encodeURIComponent(siteId);
  if (kind === "note" || kind === "reply" || kind === "mention") {
    return `/?site=${site}&panel=discussion`;
  }
  if (kind === "suggestion" || kind === "decision") {
    return `/?site=${site}&panel=proposal`;
  }
  if (kind === "flag") {
    return `/?view=review&site=${site}`;
  }
  return `/?site=${site}`;
}

export function absoluteSiteUrl(origin: string, kind: FeedKind, siteId: string): string {
  const base = origin.replace(/\/$/, "");
  const path = feedSitePath(kind, siteId);
  return path === "/" ? `${base}/` : `${base}${path}`;
}
