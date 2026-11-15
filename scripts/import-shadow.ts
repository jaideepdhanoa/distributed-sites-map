import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { withConnectionString } from "../lib/actions/db";
import { importChanged } from "../lib/changes/backfill";
import { assertWorkbookImportAllowed } from "../lib/changes/guard";
import { workbookFromFiles } from "../lib/changes/workbook";
import { collectGenerated } from "../lib/snapshot/hash";

function summary(text: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  appendFileSync(file, text.endsWith("\n") ? text : `${text}\n`);
}

function publicError(error: unknown): string {
  const text = error instanceof Error ? error.message : "shadow import failed";
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]")
    .replace(/\b[\w.-]+\.neon\.tech\b/gi, "[redacted-host]")
    .slice(0, 500);
}

async function main(): Promise<void> {
  const url = process.env.NEON_DATABASE_URL?.trim() || "";
  const snapshotId = process.env.SNAPSHOT_ID?.trim() || "";
  if (!snapshotId) {
    console.error("SNAPSHOT_ID is not set. The import runs only after a snapshot publish.");
    process.exit(1);
  }
  assertWorkbookImportAllowed(url);
  const files = collectGenerated(join(process.cwd(), "data", "generated"));
  const deals = files.find((file) => file.name === "deals.geojson")?.body || "";
  const timeline = files.find((file) => file.name === "timeline.json")?.body || "";
  const comms = files.find((file) => file.name === "comms.json")?.body || "";
  try {
    const imported = await withConnectionString(url, (sql) =>
      importChanged(sql, workbookFromFiles({ deals, timeline, comms }), snapshotId),
    );
    const line = `Shadow import inserted stage ${imported.inserted.stage}, activity ${imported.inserted.activity}, comms ${imported.inserted.comms}. Unchanged stage ${imported.unchanged.stage}, activity ${imported.unchanged.activity}, comms ${imported.unchanged.comms}. Invalid stage ${imported.invalid.stage}, activity ${imported.invalid.activity}, comms ${imported.invalid.comms}.`;
    console.log(line);
    summary(`## Shadow import\n\n${line}\n\nSource: workbook snapshot ${snapshotId}. Invalid workbook values were left unchanged and were not rewritten.\n`);
  } catch (error) {
    const missing = error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "42P01";
    if (missing) {
      const message = "The events tables are not on production. Run the Production migrations workflow. The snapshot is already live.";
      console.log(message);
      summary(`## Shadow import skipped\n\n${message}\n`);
      return;
    }
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error(publicError(error));
  summary("## Shadow import failed\n\nThe snapshot is already live. The shadow tables were not updated.\n");
  process.exit(1);
});
