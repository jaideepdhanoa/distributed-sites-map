import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withConnectionString } from "../lib/actions/db";
import { importChanged } from "../lib/changes/backfill";
import { importEntityFromWorkbook } from "../lib/changes/flags";
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
  const text = error instanceof Error ? error.message : "shadow import failed";
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
  if (google && importEntityFromWorkbook("comms")) {
    const full = await readCommsSummaries(await sheetsAccessToken(google, MIRROR_SHEETS_SCOPE));
    slice = overlaySummaryMap(slice, full);
    sheetSummaries = full.size > 0;
  }
  try {
    const imported = await withConnectionString(url, (sql) => importChanged(sql, slice, snapshotId));
    const line = `Shadow import inserted stage ${imported.inserted.stage}, activity ${imported.inserted.activity}, comms ${imported.inserted.comms}, site ${imported.inserted.site}. Unchanged stage ${imported.unchanged.stage}, activity ${imported.unchanged.activity}, comms ${imported.unchanged.comms}, site ${imported.unchanged.site}. Invalid stage ${imported.invalid.stage}, activity ${imported.invalid.activity}, comms ${imported.invalid.comms}, site ${imported.invalid.site}.`;
    const pending = imported.unmigrated.length
      ? ` Pending migration: ${imported.unmigrated.join(", ")}. Run the Production migrations workflow. The other entities were still imported.`
      : "";
    const skipped = imported.cut_over.length ? ` Skipped because the database is the record: ${imported.cut_over.join(", ")}.` : "";
    const privateNote = sheet ? "" : " Site rows were not imported. Set SITE_SHEET_PATH to the private raw sheet. It is not in the public snapshot.";
    const summaryNote = sheetSummaries
      ? " New comms summaries were taken from the Comms Log in full. A stored summary that is only a prefix of the sheet was left for the confirm-gated restore."
      : " Comms summaries came from the public snapshot, which clips at 300 characters. GOOGLE_SERVICE_ACCOUNT_JSON was not set.";
    console.log(`${line}${pending}${skipped}${privateNote}${summaryNote}`);
    summary(`## Shadow import\n\n${line}${pending}${skipped}${privateNote}${summaryNote}\n\nSource: workbook snapshot ${snapshotId}. Invalid workbook values were left unchanged and were not rewritten. Unknown site values were stored as written.\n`);
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
