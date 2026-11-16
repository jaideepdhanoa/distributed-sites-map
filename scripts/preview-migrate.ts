import { appendFileSync } from "node:fs";
import { withConnectionString } from "../lib/actions/db";
import { migrate } from "../lib/actions/migrate";
import { assertHostname, previewHostsMatchProduction } from "../lib/preview/env-values";
import { readPreviewBranch, resolveNeonProjectId } from "../lib/preview/neon";
import { redactSecrets } from "../lib/preview/redact";

function summary(text: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  appendFileSync(file, text.endsWith("\n") ? text : `${text}\n`);
}

const held: string[] = [];

function mask(value: string | undefined): void {
  const text = value?.trim() || "";
  if (text.length < 4) return;
  held.push(text);
  if (text.includes("\n")) return;
  process.stdout.write(`::add-mask::${text}\n`);
}

async function main(): Promise<void> {
  if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch") {
    console.error("Preview migrations run only from the Preview migrations workflow.");
    process.exit(1);
  }
  if ((process.env.CONFIRM || "").trim() !== "migrate-preview") {
    console.error("Refusing to migrate the preview branch. Type migrate-preview in the confirmation field.");
    process.exit(1);
  }
  if (process.env.ALLOW_PRODUCTION_MIGRATE === "1") {
    console.error("Refusing to migrate the preview branch with the production migrate flag set.");
    process.exit(1);
  }
  delete process.env.NEON_DATABASE_URL;
  const apiKey = process.env.NEON_API_KEY?.trim() || "";
  mask(apiKey);
  if (!apiKey) {
    console.error("NEON_API_KEY is not set.");
    process.exit(1);
  }
  let productionHost = "";
  try {
    productionHost = assertHostname(process.env.NEON_PRODUCTION_HOST || "");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "NEON_PRODUCTION_HOST must be a hostname.");
    process.exit(1);
  }
  const projectId = await resolveNeonProjectId(apiKey, process.env.NEON_PROJECT_ID || "");
  const preview = await readPreviewBranch({ apiKey, projectId, onSecret: mask });
  mask(preview.pooled);
  mask(preview.direct);
  if (previewHostsMatchProduction(preview.pooled, preview.direct, productionHost)) {
    console.error("Refusing to migrate the production database from the preview workflow.");
    process.exit(1);
  }
  const applied = await withConnectionString(preview.pooled, (sql) => migrate(sql, { connectionString: preview.pooled }));
  console.log(JSON.stringify({ applied }));
  summary(`## Preview migrations\n\nApplied ${applied.length} file${applied.length === 1 ? "" : "s"} on the Neon branch named preview.\n`);
}

main().catch((error: unknown) => {
  console.error(redactSecrets(error instanceof Error ? error.message : "Preview migrate failed.", held));
  process.exit(1);
});
