import { actionsEnabled, withSql } from "@/lib/actions/db";
import type { Point } from "./options";
import { assessedLayouts } from "./assessmentLoad";
import { mapZones, type MapSpaceSite, type OutlineNote, type SpaceCatalog } from "./mapCatalog";

type Deal = {
  properties?: Record<string, unknown>;
  geometry?: { type?: string; coordinates?: unknown } | null;
};

export async function mapCatalog(deals: Deal[], rows = assessedLayouts()): Promise<SpaceCatalog> {
  const ids = rows.map(([id]) => id);
  let reviewsAvailable = true;
  let notes: OutlineNote[] = [];
  if (actionsEnabled() && ids.length) {
    try {
      notes = await withSql(
        async (sql) =>
          (
            await sql.query<OutlineNote>(
              `SELECT target_id, body FROM notes WHERE target_kind='deal' AND target_id=ANY($1::text[])
          AND parent_id IS NULL AND deleted_at IS NULL AND body LIKE 'Space option review' || chr(10) || '%'
          ORDER BY created_at DESC, id DESC`,
              [ids],
            )
          ).rows,
      );
    } catch {
      reviewsAvailable = false;
    }
  }
  const indexed = new Map(deals.map((deal) => [String(deal.properties?.deal_id || ""), deal]));
  const sites: MapSpaceSite[] = [];
  for (const [id, row] of rows) {
    if (!row?.image || row.status !== "reviewed" || !row.zones.some((zone) => zone.kind !== "clear"))
      continue;
    const { id: frameId, bounds, date, source, kind, width, height, metersPerPixel } = row.image;
    const deal = indexed.get(id);
    const props = deal?.properties;
    const cohort = props
      ? /off[ -]?market/i.test(String(props.stage))
        ? "off-market"
        : props.stage_group === "dropped"
          ? "dropped"
          : "active"
      : row.cohort;
    const location = deal?.geometry?.coordinates;
    const pin: Point | null =
      Array.isArray(location) && location.length === 2 && location.every(Number.isFinite)
        ? [location[0], location[1]]
        : null;
    sites.push({
      id,
      name: String(props?.name || props?.address || row.segment || id),
      market: id.split("-")[1],
      cohort,
      revision: row.revision,
      frame: { id: frameId, bounds, date, source, kind, width, height, metersPerPixel },
      center: bounds ? [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] : pin,
      zones: mapZones(id, row, notes),
    });
  }
  return { sites, reviewsAvailable };
}
