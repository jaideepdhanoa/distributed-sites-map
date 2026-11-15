import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { withConnectionString } from "../lib/actions/db";
import { importChanged } from "../lib/changes/backfill";
import { assertWorkbookImportAllowed } from "../lib/changes/guard";
import { workbookFromFiles } from "../lib/changes/workbook";
import { collectGenerated } from "../lib/snapshot/hash";
import { unpackFile } from "../lib/snapshot/pack";
import { selectLiveBundle } from "../lib/snapshot/store";

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

async function publishedSnapshot(url: string): Promise<{ id: string; deals: string; timeline: string; comms: string }> {
  const given = process.env.SNAPSHOT_ID?.trim() || "";
  if (given) {
    const files = collectGenerated(join(process.cwd(), "data", "generated"));
    return {
      id: given,
      deals: files.find((file) => file.name === "deals.geojson")?.body || "",
      timeline: files.find((file) => file.name === "timeline.json")?.body || "",
      comms: files.find((file) => file.name === "comms.json")?.body || "",
    };
  }
  return withConnectionString(url, async (sql) => {
    const bundle = await selectLiveBundle(sql);
    if (!bundle) throw new Error("No live snapshot is published. Run Workbook sync first.");
    const read = (name: string): string => {
      const packed = bundle.files[name];
      if (!packed) throw new Error(`The live snapshot is missing ${name}.`);
      return unpackFile(packed);
    };
    return {
      id: bundle.id,
      deals: read("deals.geojson"),
      timeline: read("timeline.json"),
      comms: read("comms.json"),
    };
  });
}

async function main(): Promise<void> {
  const url = process.env.NEON_DATABASE_URL?.trim() || "";
  assertWorkbookImportAllowed(url);
  const snapshot = await publishedSnapshot(url);
  const snapshotId = snapshot.id;
  const { deals, timeline, comms } = snapshot;
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
