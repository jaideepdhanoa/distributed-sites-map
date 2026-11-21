import type { Sql } from "@/lib/actions/db";
import { normalizeApn, samePlaceAddress } from "@/lib/universeMatch";

export const UNIVERSE_REPAIR_CONFIRM = "repair-universe-duplicates";

export type UniverseFold = {
  siteId: string;
  fromId: string;
  toId: string;
};

type Row = {
  universe_id: string;
  site_id: string;
  market: string;
  address: string;
  apn: string;
  listing_id: string;
  merged_into: string;
};

/** A Pipeline row that was minted beside a census row for the same place. Ids only. */
export async function planUniverseFolds(sql: Sql): Promise<UniverseFold[]> {
  const rows = await sql.query<Row>(
    `SELECT universe_id, site_id, market, address, apn, listing_id, merged_into
     FROM universe_rows`,
  );
  const open = rows.rows.filter((row) => !row.merged_into && !row.site_id);
  const pipes = rows.rows.filter((row) => !row.merged_into && row.site_id.startsWith("PIPE-"));
  const folds: UniverseFold[] = [];
  const claimed = new Set<string>();
  for (const dup of pipes) {
    const apn = normalizeApn(dup.apn);
    const keep = open.find((row) => {
      if (row.market !== dup.market || row.universe_id === dup.universe_id) return false;
      if (samePlaceAddress(row.address, dup.address)) return true;
      return Boolean(apn) && normalizeApn(row.apn) === apn;
    });
    if (!keep || keep.site_id || claimed.has(keep.universe_id)) continue;
    claimed.add(keep.universe_id);
    folds.push({ siteId: dup.site_id, fromId: dup.universe_id, toId: keep.universe_id });
  }
  folds.sort((a, b) => a.siteId.localeCompare(b.siteId));
  return folds;
}

export function formatUniverseFolds(folds: UniverseFold[]): string {
  if (!folds.length) return "No duplicate Universe rows.";
  return folds.map((row) => `${row.siteId} ${row.fromId} -> ${row.toId}`).join("\n");
}

/** Point the Pipeline site at the census row and retire the duplicate. The row stays. */
export async function applyUniverseFolds(sql: Sql, folds: UniverseFold[]): Promise<number> {
  let written = 0;
  for (const fold of folds) {
    await sql.exec("BEGIN");
    try {
      const listing = await sql.query<{ listing_id: string }>(
        `SELECT listing_id FROM universe_rows WHERE universe_id = $1`,
        [fold.fromId],
      );
      const listingId = listing.rows[0]?.listing_id || "";
      await sql.query(`UPDATE sites SET universe_id = $2 WHERE site_id = $1`, [fold.siteId, fold.toId]);
      await sql.query(`UPDATE site_mints SET universe_id = $2 WHERE site_id = $1`, [fold.siteId, fold.toId]);
      await sql.query(
        `UPDATE universe_rows
         SET site_id = $2, listing_id = CASE WHEN $3 = '' THEN listing_id ELSE $3 END
         WHERE universe_id = $1 AND site_id = ''`,
        [fold.toId, fold.siteId, listingId],
      );
      await sql.query(
        `UPDATE universe_rows SET site_id = '', merged_into = $2 WHERE universe_id = $1`,
        [fold.fromId, fold.toId],
      );
      await sql.exec("COMMIT");
      written += 1;
    } catch (error) {
      try {
        await sql.exec("ROLLBACK");
      } catch {
        // The connection already closed the transaction.
      }
      throw error;
    }
  }
  return written;
}

export function assertUniverseRepairApply(url: string, confirm: string | undefined): void {
  if ((confirm || "").trim() !== UNIVERSE_REPAIR_CONFIRM) {
    throw new Error("Refusing to fold Universe rows. Dry run is the default. Set CONFIRM=repair-universe-duplicates to apply.");
  }
  if (process.env.VERCEL_ENV === "preview" || process.env.VERCEL_ENV === "production") {
    throw new Error("Refusing to fold Universe rows from Vercel.");
  }
  const ci = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
  const manual = process.env.GITHUB_EVENT_NAME === "workflow_dispatch"
    && process.env.ALLOW_REPAIR_UNIVERSE_DUPLICATES === "1"
    && process.env.GITHUB_REF === "refs/heads/main";
  if (ci && !manual) {
    throw new Error("Refusing to fold Universe rows from CI. Run the workflow by hand on main with the confirm phrase.");
  }
  const host = (url || "").toLowerCase();
  const named = process.env.NEON_PRODUCTION_HOST?.trim().toLowerCase();
  const production = Boolean(named && host.includes(named));
  if (production && process.env.ALLOW_REPAIR_UNIVERSE_DUPLICATES !== "1") {
    throw new Error("Refusing to fold Universe rows on the production database. Set ALLOW_REPAIR_UNIVERSE_DUPLICATES=1 only after the dry-run list is approved.");
  }
}
