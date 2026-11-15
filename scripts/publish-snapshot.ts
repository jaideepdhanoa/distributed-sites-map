import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withConnectionString } from "../lib/actions/db";
import { migrate } from "../lib/actions/migrate";
import { SAFE_FILE_NAME, workbookModifiedAt } from "../lib/snapshot/pack";
import { publishSnapshot, snapshotWriteBlocked } from "../lib/snapshot/store";

function summary(text: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  appendFileSync(file, text.endsWith("\n") ? text : `${text}\n`);
}

function publicError(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : "publish failed";
  return text.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]").slice(0, 500);
}

function collect(dir: string): { name: string; body: string }[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => SAFE_FILE_NAME.test(name) && /\.(json|geojson|csv)$/.test(name))
    .sort()
    .map((name) => ({ name, body: readFileSync(join(dir, name), "utf8") }));
}

async function main(): Promise<void> {
  const blocked = snapshotWriteBlocked();
  if (blocked) {
    console.error(blocked);
    process.exit(1);
  }
  const url = process.env.NEON_DATABASE_URL?.trim() || "";
  if (!url) {
    const message = "NEON_DATABASE_URL is not set. Skipping the database snapshot. Add the repository secret NEON_DATABASE_URL (the Neon production pooled connection string). Until then, the sync opens a pull request.";
    console.log(message);
    summary(`## Snapshot skipped\n\n${message}\n`);
    process.exit(0);
  }
  const files = collect(join(process.cwd(), "data", "generated"));
  const funnel = files.find((file) => file.name === "funnel.json")?.body;
  const published = await withConnectionString(url, async (sql) => {
    await migrate(sql);
    return publishSnapshot(sql, {
      sourceRunId: process.env.GITHUB_RUN_ID || "",
      workbookModifiedAt: workbookModifiedAt(funnel),
      gitSha: process.env.GITHUB_SHA || "",
      files,
    });
  });
  const line = `Published snapshot ${published.id} at ${published.createdAt}. Files: ${published.rowCounts.files ?? files.length}.`;
  console.log(line);
  summary(`## Snapshot live\n\n${line}\n`);
}

main().catch((error: unknown) => {
  console.error(publicError(error));
  summary("## Snapshot publish failed\n\nNo new snapshot went live. The previous live snapshot stays.\n");
  process.exit(1);
});
