export function appOrigin(): string {
  const explicit = (process.env.ALERT_APP_ORIGIN || "").trim().replace(/\/$/, "");
  if (explicit) return explicit;
  const production = (process.env.VERCEL_PROJECT_PRODUCTION_URL || "").trim();
  if (production) return `https://${production.replace(/^https?:\/\//, "")}`;
  const preview = (process.env.VERCEL_URL || "").trim();
  if (preview) return `https://${preview.replace(/^https?:\/\//, "")}`;
  return "";
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
