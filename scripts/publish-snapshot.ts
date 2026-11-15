import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { withConnectionString } from "../lib/actions/db";
import { migrate } from "../lib/actions/migrate";
import { photoStoreError, storeReferencedPhotos } from "../lib/photos/store";
import { collectGenerated } from "../lib/snapshot/hash";
import { workbookModifiedAt } from "../lib/snapshot/pack";
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
  const generated = join(process.cwd(), "data", "generated");
  const files = collectGenerated(generated);
  const funnel = files.find((file) => file.name === "funnel.json")?.body;
  const published = await withConnectionString(url, async (sql) => {
    await migrate(sql, { connectionString: url, onProduction: "skip" });
    const ready = await sql.query<{ name: string | null }>(`SELECT to_regclass('public.snapshots') AS name`);
    if (!ready.rows[0]?.name) {
      throw new Error("The snapshots table is missing. Run the Production migrations workflow. This job does not migrate production.");
    }
    const snapshot = await publishSnapshot(sql, {
      sourceRunId: process.env.GITHUB_RUN_ID || "",
      workbookModifiedAt: workbookModifiedAt(funnel),
      gitSha: process.env.GITHUB_SHA || "",
      files,
    });
    let photos = "Photo files were not stored.";
    try {
      photos = (await storeReferencedPhotos(sql, files, join(generated, "photos"))).message;
    } catch (error) {
      photos = `Photo files were not stored. ${photoStoreError(error)}`;
    }
    return { snapshot, photos };
  });
  const line = `Published snapshot ${published.snapshot.id} at ${published.snapshot.createdAt}. Files: ${published.snapshot.rowCounts.files ?? files.length}. ${published.photos}`;
  console.log(line);
  summary(`## Snapshot live\n\n${line}\n`);
  // The shadow import is a later step in workbook-sync.yml. It runs only
  // after this publish succeeds, and a hash match never reaches this script.
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `snapshot_id=${published.snapshot.id}\n`);
  }
}

main().catch((error: unknown) => {
  console.error(publicError(error));
  summary("## Snapshot publish failed\n\nNo new snapshot went live. The previous live snapshot stays.\n");
  process.exit(1);
});
