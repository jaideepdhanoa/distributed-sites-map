import type { Sql } from "@/lib/actions/db";
import { buildReport, readDatabaseSlice, type DiffReport } from "./diff";
import { PROTECTED_SITE_ID } from "./mirror";
import { shortHash } from "./site";
import type { WorkbookSlice } from "./workbook";

const ENTITIES = ["stage", "activity", "comms", "site"] as const;

function mentionsProtected(siteId: string, siteIds = ""): boolean {
  if (siteId === PROTECTED_SITE_ID) return true;
  return siteIds.split(/[;,\s]+/).some((part) => part === PROTECTED_SITE_ID);
}

/** Drop the quarantined site before a comparison. The count does not name it. */
export function omitQuarantine(slice: WorkbookSlice): { slice: WorkbookSlice; skipped: number } {
  let skipped = 0;
  const stages = slice.stages.filter((row) => {
    if (!mentionsProtected(row.site_id)) return true;
    skipped += 1;
    return false;
  });
  const activities = slice.activities.filter((row) => {
    if (!mentionsProtected(row.site_id)) return true;
    skipped += 1;
    return false;
  });
  const comms = slice.comms.filter((row) => {
    if (!mentionsProtected(row.site_id, row.site_ids || "")) return true;
    skipped += 1;
    return false;
  });
  const sites = (slice.sites || []).filter((row) => {
    if (!mentionsProtected(row.site_id)) return true;
    skipped += 1;
    return false;
  });
  return { slice: { ...slice, stages, activities, comms, sites }, skipped };
}

/** Counts and hashed ids. Cell text is not included. */
export function formatDriftCounts(report: DiffReport, skippedProtected: number): string {
  const lines = ["Workbook drift. Rows were not written to the database."];
  for (const name of ENTITIES) {
    const row = report.entities[name];
    const changed = row.changed.filter((item) => !item.truncated && !item.blanked && item.id !== PROTECTED_SITE_ID);
    const held = row.changed.filter((item) => (item.truncated || item.blanked) && item.id !== PROTECTED_SITE_ID);
    const missing = row.missing.filter((id) => id !== PROTECTED_SITE_ID);
    const extra = row.extra.filter((id) => id !== PROTECTED_SITE_ID);
    const invalid = report.invalid[name].filter((issue) => issue.id !== PROTECTED_SITE_ID).length;
    const ids = [...new Set([...changed.map((item) => item.id), ...missing, ...extra])].map((id) => shortHash(id)).sort();
    lines.push(`${name} changed ${changed.length} missing ${missing.length} extra ${extra.length} held ${held.length} invalid ${invalid}`);
    const shown = ids.slice(0, 20).map((hash) => `#${hash}`).join(" ");
    lines.push(`${name}_ids ${ids.length}${shown ? ` ${shown}` : ""}${ids.length > 20 ? ` and ${ids.length - 20} more` : ""}`);
  }
  lines.push(`skipped_protected ${skippedProtected}`);
  lines.push("Cell text is not printed.");
  const text = lines.join("\n");
  if (text.includes(PROTECTED_SITE_ID)) throw new Error("Drift report included a quarantined id.");
  return text;
}

/**
 * Compare the workbook with the database and write nothing.
 * Read flags do not hide a difference. The scheduled sync uses this
 * instead of applying workbook rows.
 */
export async function detectWorkbookDrift(sql: Sql, slice: WorkbookSlice): Promise<{ text: string; skippedProtected: number }> {
  const database = await readDatabaseSlice(sql);
  const left = omitQuarantine(slice);
  const right = omitQuarantine(database);
  const report = buildReport(left.slice, right.slice, "workbook", true);
  const skippedProtected = left.skipped + right.skipped;
  return { text: formatDriftCounts(report, skippedProtected), skippedProtected };
}
