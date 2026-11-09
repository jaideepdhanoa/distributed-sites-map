const DEFAULT_APP_URL = "https://distributedsites.com";

/** Host for links in alert mail. APP_URL wins. Otherwise the production domain. */
export function appOrigin(): string {
  const explicit = (process.env.APP_URL || "").trim().replace(/\/$/, "");
  if (explicit) return explicit;
  return DEFAULT_APP_URL;
}

function withOrigin(path: string): string {
  const origin = appOrigin();
  return origin ? `${origin}${path}` : path;
}

export function reviewHref(siteId: string): string {
  return withOrigin(`/?view=review&site=${encodeURIComponent(siteId)}`);
}

export function discussionHref(siteId: string): string {
  return withOrigin(`/?site=${encodeURIComponent(siteId)}&panel=discussion`);
}

export function reviewHomeHref(): string {
  return withOrigin("/?view=review");
}
