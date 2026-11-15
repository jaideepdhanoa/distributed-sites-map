import { withConnectionString } from "../lib/actions/db";
import { migrate } from "../lib/actions/migrate";

function redact(error: unknown): string {
  const text = error instanceof Error ? error.message : "migrate failed";
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]")
    .replace(/\b[\w.-]+\.neon\.tech\b/gi, "[redacted-host]")
    .slice(0, 500);
}

async function main(): Promise<void> {
  if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" || process.env.ALLOW_PRODUCTION_MIGRATE !== "1") {
    console.error("Production migrations run only from the Production migrations workflow.");
    process.exit(1);
  }
  if ((process.env.CONFIRM || "").trim() !== "migrate-production") {
    console.error("Refusing to migrate production. Type migrate-production in the confirmation field.");
    process.exit(1);
  }
  const url = process.env.NEON_DATABASE_URL?.trim() || "";
  if (!url) {
    console.error("NEON_DATABASE_URL is not set. Add the repository secret: the Neon production pooled connection string.");
    process.exit(1);
  }
  const applied = await withConnectionString(url, (sql) => migrate(sql, { connectionString: url }));
  console.log(JSON.stringify({ applied }));
}

main().catch((error: unknown) => {
  console.error(redact(error));
  process.exit(1);
});
