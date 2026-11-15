import { timingSafeEqual } from "node:crypto";

const PRODUCTION_HOSTS = new Set(["distributedsites.com", "www.distributedsites.com"]);

export function authorizeSnapshotRevalidate(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim() || "";
  if (!secret) return false;
  const header = request.headers.get("authorization") || "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  if (expected.length !== actual.length) {
    timingSafeEqual(expected, expected);
    return false;
  }
  return timingSafeEqual(actual, expected);
}

/** The sync job may refresh only the production site. Preview hosts are rejected. */
export function productionRevalidateUrl(raw: string | undefined): string {
  const url = new URL((raw || "").trim() || "https://distributedsites.com/api/data/revalidate");
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("The cache refresh URL must be the production https path.");
  }
  if (!PRODUCTION_HOSTS.has(url.hostname) || url.pathname !== "/api/data/revalidate") {
    throw new Error("Refusing to refresh a host that is not the production site.");
  }
  return url.toString();
}
