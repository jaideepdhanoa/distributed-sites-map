/** Hostname of a Postgres URL, or "" when the value is empty or not a URL. */
export function databaseHost(url: string | null | undefined): string {
  const value = String(url || "").trim();
  if (!value) return "";
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Neon serves the same compute at host and host-with--pooler. */
export function sameDatabaseHost(left: string, right: string): boolean {
  const direct = (host: string) => host.trim().toLowerCase().replace("-pooler.", ".");
  const a = direct(left);
  const b = direct(right);
  return Boolean(a) && a === b;
}
