import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withConnectionString } from "../lib/actions/db";
import { migrate } from "../lib/actions/migrate";
import { importShadow } from "../lib/changes/backfill";
import { diffDatabase, renderReport } from "../lib/changes/diff";
import { assertPreviewTarget } from "../lib/changes/guard";
import { unpackFile } from "../lib/snapshot/pack";
import { selectLiveBundle } from "../lib/snapshot/store";
import { workbookFromFiles, type WorkbookSlice } from "../lib/changes/workbook";

function summary(text: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  appendFileSync(file, text.endsWith("\n") ? text : `${text}\n`);
}

function redact(error: unknown): string {
  const text = error instanceof Error ? error.message : "shadow job failed";
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]")
    .replace(/\b[\w.-]+\.neon\.tech\b/gi, "[redacted-host]")
    .slice(0, 500);
}

function disk(name: string): string {
  return readFileSync(join(process.cwd(), "data", "generated", name), "utf8");
}

async function loadWorkbook(sql: Parameters<typeof selectLiveBundle>[0]): Promise<{ label: string; slice: WorkbookSlice }> {
  const bundle = await selectLiveBundle(sql);
  const read = (name: string): string => {
    const packed = bundle?.files[name];
    if (!packed) return disk(name);
    return unpackFile(packed);
  };
  const label = bundle ? `snapshot ${bundle.id}` : "data/generated (no live snapshot)";
  return {
    label,
    slice: workbookFromFiles({
      deals: read("deals.geojson"),
      timeline: read("timeline.json"),
      comms: read("comms.json"),
    }),
  };
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== "diff" && command !== "backfill") {
    console.error("Use diff or backfill.");
    process.exit(1);
  }
  const url = process.env.DATABASE_URL?.trim() || "";
  assertPreviewTarget(url, command);
  await withConnectionString(url, async (sql) => {
    await migrate(sql, { connectionString: url });
    const loaded = await loadWorkbook(sql);
    if (command === "backfill") {
      const counts = await importShadow(sql, loaded.slice, loaded.label);
      const line = `Shadow backfill inserted stage ${counts.inserted.stage}, activity ${counts.inserted.activity}, comms ${counts.inserted.comms}. Skipped stage ${counts.skipped.stage}, activity ${counts.skipped.activity}, comms ${counts.skipped.comms}.`;
      console.log(line);
      summary(`## Shadow backfill\n\n${line}\n\nSource: ${loaded.label}. A second run inserts nothing. This did not write the workbook.\n`);
    }
    const report = await diffDatabase(sql, loaded.slice, loaded.label);
    writeFileSync(join(process.cwd(), "shadow-diff.json"), `${JSON.stringify({ ...report, generated_at: new Date().toISOString() }, null, 2)}\n`);
    const rendered = renderReport(report);
    console.log(rendered);
    summary(rendered);
  });
}

main().catch((error: unknown) => {
  const message = redact(error);
  console.error(message);
  summary(`## Shadow job failed\n\n${message}\n`);
  process.exit(1);
});
