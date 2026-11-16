import { databaseHost, sameDatabaseHost } from "@/lib/changes/host";

export const PREVIEW_POINTS_AT_PRODUCTION = "Preview is pointed at production";

/**
 * True on a Vercel deployment that is not production.
 * Local runs and GitHub Actions leave VERCEL_ENV unset and stay allowed.
 */
export function vercelOutsideProduction(): boolean {
  const env = process.env.VERCEL_ENV?.trim() || "";
  return env !== "" && env !== "production";
}

export function productionJobAllowed(): boolean {
  return !vercelOutsideProduction();
}

export function outboundMailEnabled(): boolean {
  return !vercelOutsideProduction();
}

export function askCallsAllowed(): boolean {
  return !vercelOutsideProduction();
}

/** Preview and Vercel development must not share production Redis keys. */
export function isolatedKey(key: string): string {
  return vercelOutsideProduction() ? `preview:${key}` : key;
}

/**
 * Preview is using the production database when its URL host matches the
 * production hostname. The hostname is compared with and without the Neon
 * pooler label. The value is not printed.
 */
export function previewPointsAtProduction(url?: string | null): boolean {
  if (process.env.VERCEL_ENV !== "preview") return false;
  const current = databaseHost(url === undefined ? process.env.DATABASE_URL : url);
  if (!current) return false;
  const named = process.env.NEON_PRODUCTION_HOST?.trim() || "";
  if (named && sameDatabaseHost(current, named)) return true;
  const productionUrl = process.env.NEON_DATABASE_URL?.trim() || "";
  const productionHost = databaseHost(productionUrl);
  return Boolean(productionHost) && sameDatabaseHost(current, productionHost);
}
