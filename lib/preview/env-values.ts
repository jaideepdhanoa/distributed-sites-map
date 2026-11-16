import { sameDatabaseHost } from "@/lib/changes/host";

export type PreviewValue = {
  value: string;
  type: "sensitive" | "plain";
};

export function assertHostname(value: string): string {
  const host = value.trim().toLowerCase();
  if (
    !host ||
    host.includes("://") ||
    host.includes("/") ||
    host.includes("@") ||
    host.includes(":") ||
    host.includes(" ") ||
    host.includes("..") ||
    host.startsWith(".") ||
    host.endsWith(".") ||
    !/^[a-z0-9.-]+$/.test(host)
  ) {
    throw new Error("NEON_PRODUCTION_HOST must be a hostname, with no user and no password.");
  }
  return host;
}

export function splitConnectionUri(uri: string): { host: string; user: string; password: string; database: string } {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new Error("The preview connection string could not be read.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("The preview connection string could not be read.");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!url.hostname || !url.username || !database) {
    throw new Error("The preview connection string could not be read.");
  }
  return {
    host: url.hostname.toLowerCase(),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
  };
}

export function withoutSsl(uri: string): string {
  if (/[?&]sslmode=/i.test(uri)) return uri.replace(/sslmode=[^&]*/i, "sslmode=disable");
  return `${uri}${uri.includes("?") ? "&" : "?"}sslmode=disable`;
}

export function previewHostsMatchProduction(pooled: string, direct: string, productionHost: string): boolean {
  const pooledHost = splitConnectionUri(pooled).host;
  const directHost = splitConnectionUri(direct).host;
  return sameDatabaseHost(pooledHost, productionHost) || sameDatabaseHost(directHost, productionHost);
}

/** Map a preview connection string onto the database env vars. Values stay out of logs. */
export function previewTargetValues(input: { pooled: string; direct: string; productionHost: string }): Map<string, PreviewValue> {
  const productionHost = assertHostname(input.productionHost);
  if (previewHostsMatchProduction(input.pooled, input.direct, productionHost)) {
    throw new Error("Refusing to point Preview at the production database host.");
  }
  const pooled = splitConnectionUri(input.pooled);
  const direct = splitConnectionUri(input.direct);
  const sensitive = (value: string): PreviewValue => ({ value, type: "sensitive" });
  const map = new Map<string, PreviewValue>();
  for (const key of ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "NEON_DATABASE_URL"]) {
    map.set(key, sensitive(input.pooled));
  }
  for (const key of ["DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING"]) map.set(key, sensitive(input.direct));
  map.set("POSTGRES_URL_NO_SSL", sensitive(withoutSsl(input.direct)));
  for (const key of ["PGHOST", "POSTGRES_HOST"]) map.set(key, sensitive(pooled.host));
  map.set("PGHOST_UNPOOLED", sensitive(direct.host));
  for (const key of ["PGUSER", "POSTGRES_USER"]) map.set(key, sensitive(pooled.user));
  for (const key of ["PGPASSWORD", "POSTGRES_PASSWORD"]) map.set(key, sensitive(pooled.password));
  for (const key of ["PGDATABASE", "POSTGRES_DATABASE"]) map.set(key, sensitive(pooled.database));
  map.set("NEON_PRODUCTION_HOST", { value: productionHost, type: "plain" });
  return map;
}
