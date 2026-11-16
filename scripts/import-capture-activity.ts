import { appendFileSync, writeFileSync } from "node:fs";
import { withConnectionString } from "../lib/actions/db";
import { executeCaptureImport, readCaptureRows, type CaptureMode } from "../lib/changes/captureImport";
import { MIRROR_SHEETS_SCOPE } from "../lib/changes/mirror";
import { formatZonedTimestamp } from "../lib/changes/schema";
import { sheetsAccessToken } from "../lib/changes/sheetsAuth";

/**
 * Copy workbook Activity rows of type capture into the database.
 *
 * The existing A- id is kept. A date with no clock is stored with
 * at_approximate and the source "workbook capture import, row <id>".
 * An id that is already stored is skipped. The sheet is not written.
 * Dry run is the default. The log is counts, workbook ids, site ids,
 * kind, and date. A local apply needs CONFIRM=import-production and a
 * localhost database. Production writes run only from the Capture import
 * workflow on main.
 *
 *   npx tsx scripts/import-capture-activity.ts
 *
 *   CONFIRM=import-production npx tsx scripts/import-capture-activity.ts --apply
 */

function redact(error: unknown): string {
  const text = error instanceof Error ? error.message : "capture import failed";
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]")
    .replace(/\b[\w.-]+\.neon\.tech\b/gi, "[redacted-host]")
    .replace(/ya29\.[A-Za-z0-9._-]+/g, "[redacted-token]")
    .replace(/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, "[redacted-key]")
    .replace(/"private_key"\s*:\s*"(?:\\.|[^"\\])*"/g, '"private_key":"[redacted]"')
    .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, "[redacted-email]")
    .replace(/https?:\/\/\S+/gi, "[redacted-link]")
    .replace(/\$\d[\d,]*(?:\.\d+)?/g, "[redacted-price]")
    .slice(0, 500);
}

function modeOf(requested: boolean): CaptureMode {
  const raw = (process.env.CAPTURE_IMPORT_MODE || (requested ? "write" : "dry-run")).trim();
  if (raw !== "dry-run" && raw !== "write") throw new Error("Mode must be dry-run or write.");
  return raw;
}

async function main(): Promise<void> {
  const requested = process.argv.includes("--apply");
  const mode = modeOf(requested);
  const apply = requested && mode === "write";
  if (requested && !apply) throw new Error("Refusing to write. Set mode to write and type import-production.");
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() || "";
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set.");
  const url = process.env.NEON_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || "";
  if (!url) throw new Error("NEON_DATABASE_URL is not set.");
  const who = (process.env.IMPORT_ACTOR || process.env.GITHUB_ACTOR || "").trim();
  const at = formatZonedTimestamp();
  const rows = await readCaptureRows(await sheetsAccessToken(raw, MIRROR_SHEETS_SCOPE));
  const planPath = process.env.CAPTURE_IMPORT_PLAN_PATH || "capture-import-plan.json";
  const summary = process.env.GITHUB_STEP_SUMMARY;
  const result = await withConnectionString(url, (sql) =>
    executeCaptureImport(sql, rows, {
      apply,
      mode,
      databaseUrl: url,
      confirm: process.env.CONFIRM,
      who,
      at,
      onReady: ({ text, artifact }) => {
        console.log(text);
        writeFileSync(planPath, `${JSON.stringify(artifact, null, 2)}\n`);
        if (summary) appendFileSync(summary, `## Capture import\n\n\`\`\`\n${text}\n\`\`\`\n`);
      },
    }),
  );
  console.log(apply ? `Wrote ${result.written} capture rows. The sheet was not written.` : "Dry run. Nothing was written.");
}

main().catch((error: unknown) => {
  console.error(redact(error));
  process.exit(1);
});
