import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withConnectionString } from "../lib/actions/db";
import { rememberSheetIdFloors } from "../lib/changes/backfill";
import { detectWorkbookDrift } from "../lib/changes/drift";
import { assertWorkbookImportAllowed } from "../lib/changes/guard";
import { MIRROR_SHEETS_SCOPE } from "../lib/changes/mirror";
import { sheetsAccessToken } from "../lib/changes/sheetsAuth";
import { overlaySummaryMap, readCommsSummaries } from "../lib/changes/summaries";
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
  const text = error instanceof Error ? error.message : "workbook drift failed";
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]")
    .replace(/\b[\w.-]+\.neon\.tech\b/gi, "[redacted-host]")
    .slice(0, 500);
}

function optionalFile(files: { name: string; body: string }[], name: string): string {
  return files.find((file) => file.name === name)?.body || "";
}

function privateSheet(): string {
  const path = process.env.SITE_SHEET_PATH?.trim() || "";
  if (!path) return "";
  return readFileSync(path, "utf8");
}

async function publishedSnapshot(url: string): Promise<{
  id: string;
  deals: string;
  timeline: string;
  comms: string;
  pricing: string;
}> {
  const given = process.env.SNAPSHOT_ID?.trim() || "";
  if (given) {
    const files = collectGenerated(join(process.cwd(), "data", "generated"));
    return {
      id: given,
      deals: optionalFile(files, "deals.geojson"),
      timeline: optionalFile(files, "timeline.json"),
      comms: optionalFile(files, "comms.json"),
      pricing: optionalFile(files, "pricing.json"),
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
    const readOptional = (name: string): string => {
      const packed = bundle.files[name];
      return packed ? unpackFile(packed) : "";
    };
    return {
      id: bundle.id,
      deals: read("deals.geojson"),
      timeline: read("timeline.json"),
      comms: read("comms.json"),
      pricing: readOptional("pricing.json"),
    };
  });
}

async function main(): Promise<void> {
  const url = process.env.NEON_DATABASE_URL?.trim() || "";
  assertWorkbookImportAllowed(url);
  const snapshot = await publishedSnapshot(url);
  const snapshotId = snapshot.id;
  const { deals, timeline, comms, pricing } = snapshot;
  const sheet = privateSheet();
  let slice = workbookFromFiles({ deals, timeline, comms, pricing, sheet });
  if (!sheet) slice.sites = [];
  const google = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() || "";
  let sheetSummaries = false;
  if (google) {
    const full = await readCommsSummaries(await sheetsAccessToken(google, MIRROR_SHEETS_SCOPE));
    slice = overlaySummaryMap(slice, full);
    sheetSummaries = full.size > 0;
  }
  try {
    const drift = await withConnectionString(url, async (sql) => {
      const found = await detectWorkbookDrift(sql, slice);
      await rememberSheetIdFloors(sql, slice);
      return found;
    });
    const privateNote = sheet ? "" : " Site raw cells were not compared. Set SITE_SHEET_PATH to the private raw sheet. It is not in the public snapshot.";
    const summaryNote = sheetSummaries
      ? " Comms summaries were compared in full and were not written."
      : " Comms summaries came from the public snapshot, which clips at 300 characters. A longer stored summary is held, not applied. GOOGLE_SERVICE_ACCOUNT_JSON was not set.";
    console.log(`${drift.text}\n${privateNote}${summaryNote}`);
    summary(`## Workbook drift\n\n${drift.text}\n\n${privateNote}${summaryNote}\n\nSource: workbook snapshot ${snapshotId}. Workbook rows were not written to the database. Activity and comms id floors were raised from ids only.\n`);
  } catch (error) {
    const missing = error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "42P01";
    if (missing) {
      const message = "The events tables are not on production. Run the Production migrations workflow. The snapshot is already live.";
      console.log(message);
      summary(`## Workbook drift skipped\n\n${message}\n`);
      return;
    }
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error(publicError(error));
  summary("## Workbook drift failed\n\nThe snapshot is already live. The database was not updated from the workbook.\n");
  process.exit(1);
});
