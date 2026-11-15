import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withConnectionString } from "../lib/actions/db";
import { diffDatabase, renderReport } from "../lib/changes/diff";
import { assertProductionDiff } from "../lib/changes/guard";
import { workbookFromFiles, type WorkbookSlice } from "../lib/changes/workbook";
import { unpackFile } from "../lib/snapshot/pack";
import { selectLiveBundle } from "../lib/snapshot/store";
import type { Sql } from "../lib/actions/db";

function summary(text: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  appendFileSync(file, text.endsWith("\n") ? text : `${text}\n`);
}

function redact(error: unknown): string {
  const text = error instanceof Error ? error.message : "shadow diff failed";
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]")
    .replace(/\b[\w.-]+\.neon\.tech\b/gi, "[redacted-host]")
    .slice(0, 500);
}

function disk(name: string): string {
  return readFileSync(join(process.cwd(), "data", "generated", name), "utf8");
}

async function loadWorkbook(sql: Sql): Promise<{ label: string; slice: WorkbookSlice }> {
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
  const url = process.env.DATABASE_URL?.trim() || "";
  assertProductionDiff(url);
  await withConnectionString(url, async (sql) => {
    const ready = await sql.query<{ name: string | null }>(`SELECT to_regclass('public.site_stages') AS name`);
    if (!ready.rows[0]?.name) {
      const message = "The shadow tables are not on production. Run the Production migrations workflow. This diff does not migrate.";
      console.log(message);
      summary(`## Shadow diff skipped\n\n${message}\n`);
      return;
    }
    const loaded = await loadWorkbook(sql);
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
  summary(`## Shadow diff failed\n\n${message}\n`);
  process.exit(1);
});
