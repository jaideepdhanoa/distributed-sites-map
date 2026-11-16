import type { Sql } from "@/lib/actions/db";
import { InputError } from "@/lib/actions/text";
import { formatZonedTimestamp } from "@/lib/changes/schema";
import { rectanglePolygon, roundFeet, type GeoPolygon, type GroundBox, type LngLat } from "./measure";
import { estimateSlots } from "./slots";
import type { SpaceLayout, SpaceStatus, SpaceType } from "./vocab";

export type SiteSpaceRecord = {
  id: string;
  siteId: string;
  polygon: GeoPolygon;
  rotationDeg: number;
  center: LngLat;
  lengthFt: number;
  widthFt: number;
  areaSqFt: number;
  type: SpaceType;
  layout: SpaceLayout;
  estSlots: number;
  status: SpaceStatus;
  author: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

type SpaceRow = {
  id: string;
  site_id: string;
  polygon: GeoPolygon;
  rotation_deg: number | string;
  center_lng: number | string;
  center_lat: number | string;
  length_ft: number | string;
  width_ft: number | string;
  area_sqft: number | string;
  type: SpaceType;
  layout: SpaceLayout;
  est_slots: number | string;
  status: SpaceStatus;
  author: string;
  updated_by: string;
  created_at_iso: string;
  updated_at_iso: string;
  version: number | string;
};

const SELECT = `id, site_id, polygon, rotation_deg, center_lng, center_lat, length_ft, width_ft, area_sqft,
  type, layout, est_slots, status, author, updated_by, created_at_iso, updated_at_iso, version`;

function present(row: SpaceRow): SiteSpaceRecord {
  return {
    id: row.id,
    siteId: row.site_id,
    polygon: row.polygon,
    rotationDeg: Number(row.rotation_deg),
    center: { lng: Number(row.center_lng), lat: Number(row.center_lat) },
    lengthFt: Number(row.length_ft),
    widthFt: Number(row.width_ft),
    areaSqFt: Number(row.area_sqft),
    type: row.type,
    layout: row.layout,
    estSlots: Number(row.est_slots),
    status: row.status,
    author: row.author,
    updatedBy: row.updated_by,
    createdAt: row.created_at_iso,
    updatedAt: row.updated_at_iso,
    version: Number(row.version),
  };
}

export async function listSiteSpaces(sql: Sql, siteId: string): Promise<SiteSpaceRecord[]> {
  const rows = await sql.query<SpaceRow>(
    `SELECT ${SELECT} FROM site_spaces WHERE site_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC, id ASC`,
    [siteId],
  );
  return rows.rows.map(present);
}

export async function readSiteSpace(sql: Sql, id: string): Promise<SiteSpaceRecord | null> {
  const rows = await sql.query<SpaceRow>(
    `SELECT ${SELECT} FROM site_spaces WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return rows.rows[0] ? present(rows.rows[0]) : null;
}

export type SpaceWrite = {
  siteId: string;
  entityId: string;
  actorId: string;
  version: number;
  deleted: boolean;
  box?: GroundBox;
  type?: SpaceType;
  layout?: SpaceLayout;
};

function measured(box: GroundBox, type: SpaceType, layout: SpaceLayout) {
  const lengthFt = roundFeet(box.lengthFt);
  const widthFt = roundFeet(box.widthFt);
  const areaSqFt = roundFeet(lengthFt * widthFt);
  const polygon = rectanglePolygon({ ...box, lengthFt, widthFt });
  return {
    lengthFt,
    widthFt,
    areaSqFt,
    polygon,
    estSlots: estimateSlots(lengthFt, widthFt, layout),
    rotationDeg: roundFeet(box.rotationDeg),
    center: box.center,
    type,
    layout,
  };
}

function eventPayload(row: SiteSpaceRecord, deleted = false): Record<string, unknown> {
  return {
    id: row.id,
    site_id: row.siteId,
    polygon: row.polygon,
    rotation_deg: row.rotationDeg,
    center_lng: row.center.lng,
    center_lat: row.center.lat,
    length_ft: row.lengthFt,
    width_ft: row.widthFt,
    area_sqft: row.areaSqFt,
    type: row.type,
    layout: row.layout,
    est_slots: row.estSlots,
    status: row.status,
    author: row.author,
    updated_by: row.updatedBy,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    version: row.version,
    deleted,
  };
}

export async function storeSiteSpace(sql: Sql, write: SpaceWrite): Promise<Record<string, unknown>> {
  const now = formatZonedTimestamp();
  if (write.deleted) {
    const existing = await sql.query<SpaceRow>(`SELECT ${SELECT} FROM site_spaces WHERE id = $1`, [write.entityId]);
    const row = existing.rows[0];
    if (!row || row.site_id !== write.siteId) throw new InputError("That space is not on this site.", 404);
    const updated = await sql.query<SpaceRow>(
      `UPDATE site_spaces
       SET deleted_at = $2::timestamptz, updated_at = $2::timestamptz, updated_at_iso = $3, updated_by = $4, version = $5
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING ${SELECT}`,
      [write.entityId, now, now, write.actorId, write.version],
    );
    const saved = updated.rows[0];
    if (!saved) throw new InputError("That space was already deleted.", 409);
    return eventPayload(present(saved), true);
  }
  if (!write.box || !write.type || !write.layout) throw new InputError("A marked space needs a rectangle, a type, and a layout.");
  const shape = measured(write.box, write.type, write.layout);
  if (write.version === 1) {
    await sql.query(
      `INSERT INTO site_spaces (
        id, site_id, polygon, rotation_deg, center_lng, center_lat, length_ft, width_ft, area_sqft,
        type, layout, est_slots, status, author, updated_by, version, created_at, created_at_iso, updated_at, updated_at_iso
      ) VALUES (
        $1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, 'estimated', $13, $13, $14, $15::timestamptz, $16, $15::timestamptz, $16
      )`,
      [
        write.entityId,
        write.siteId,
        JSON.stringify(shape.polygon),
        shape.rotationDeg,
        shape.center.lng,
        shape.center.lat,
        shape.lengthFt,
        shape.widthFt,
        shape.areaSqFt,
        shape.type,
        shape.layout,
        shape.estSlots,
        write.actorId,
        write.version,
        now,
        now,
      ],
    );
  } else {
    const updated = await sql.query<{ id: string }>(
      `UPDATE site_spaces SET
        polygon = $3::jsonb, rotation_deg = $4, center_lng = $5, center_lat = $6,
        length_ft = $7, width_ft = $8, area_sqft = $9, type = $10, layout = $11, est_slots = $12,
        status = 'estimated', verified_source = NULL, verified_at = NULL, verified_by = NULL,
        updated_by = $13, version = $14, updated_at = $15::timestamptz, updated_at_iso = $16
       WHERE id = $1 AND site_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [
        write.entityId,
        write.siteId,
        JSON.stringify(shape.polygon),
        shape.rotationDeg,
        shape.center.lng,
        shape.center.lat,
        shape.lengthFt,
        shape.widthFt,
        shape.areaSqFt,
        shape.type,
        shape.layout,
        shape.estSlots,
        write.actorId,
        write.version,
        now,
        now,
      ],
    );
    if (!updated.rows[0]) throw new InputError("That space was deleted.", 409);
  }
  const saved = await readSiteSpace(sql, write.entityId);
  if (!saved) throw new InputError("That space could not be saved.");
  return eventPayload(saved);
}
