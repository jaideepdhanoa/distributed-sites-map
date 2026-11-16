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

/** Plain Preview-only marker set by the reset workflow. Not a secret. */
export const PREVIEW_DATABASE_BRANCH = "preview";

/** Bracket access so the value is read at request time and not inlined at build. */
function runtimeEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function previewBranchMarked(): boolean {
  return runtimeEnv("PREVIEW_DATABASE_BRANCH") === PREVIEW_DATABASE_BRANCH;
}

/**
 * Preview is closed until the reset workflow has marked this deployment as
 * the branch named preview. A marked deployment is still closed when its
 * database host matches a known production host. The host is not printed.
 */
export function previewPointsAtProduction(url?: string | null): boolean {
  if (runtimeEnv("VERCEL_ENV") !== "preview") return false;
  if (!previewBranchMarked()) return true;
  const current = databaseHost(url === undefined ? runtimeEnv("DATABASE_URL") : url);
  if (!current) return true;
  const named = runtimeEnv("NEON_PRODUCTION_HOST");
  if (named && sameDatabaseHost(current, named)) return true;
  const productionHost = databaseHost(runtimeEnv("NEON_DATABASE_URL"));
  return Boolean(productionHost) && sameDatabaseHost(current, productionHost);
}
