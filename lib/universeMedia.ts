import { actionsEnabled, withSql } from "@/lib/actions/db";
import { photosFromCanonical, type PhotoRef } from "@/lib/changes/site";

type FeatureFile = { features?: { properties?: Record<string, unknown> }[] };

function photosOf(value: unknown): PhotoRef[] {
  if (typeof value === "string") return photosFromCanonical(value);
  try {
    return photosFromCanonical(JSON.stringify(value ?? []));
  } catch {
    return [];
  }
}

function factsOf(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function missingTable(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: string }).code) : "";
  return code === "42P01" || code === "42703";
}

type MediaRow = {
  site_id: string;
  photo_refs: unknown;
  photo_status: string;
  photo_diligence_count: string;
  photo_listing_count: string;
  photos_checked: string;
  photo_notes: string;
  facts: unknown;
};

export function paintUniverseMedia<T extends FeatureFile>(file: T, rows: MediaRow[]): T {
  if (!rows.length || !file.features?.length) return file;
  const byId = new Map(rows.map((row) => [row.site_id, row]));
  return {
    ...file,
    features: file.features.map((feature) => {
      const props = feature.properties || {};
      const row = byId.get(String(props.site_id || ""));
      if (!row) return feature;
      const photos = photosOf(row.photo_refs).map((photo) => {
        const item: Record<string, string> = {};
        for (const [key, value] of Object.entries(photo)) if (value) item[key] = value;
        return item;
      });
      const facts = factsOf(row.facts);
      const evidence = typeof facts.evidence === "string" ? facts.evidence : "";
      const count = (value: string) => {
        if (!value) return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
      };
      return {
        ...feature,
        properties: {
          ...props,
          ...(photos.length ? { photos } : {}),
          photo_status: row.photo_status,
          photo_diligence_count: count(row.photo_diligence_count),
          photo_listing_count: count(row.photo_listing_count),
          photos_checked: row.photos_checked,
          photo_notes: row.photo_notes,
          ...(evidence ? { evidence } : {}),
        },
      };
    }),
  };
}

/** Paint photo and evidence writes onto universe cards. The snapshot stays when the database has no row. */
export async function overlayUniverseMedia<T extends FeatureFile>(file: T): Promise<T> {
  if (!actionsEnabled() || !file.features?.length) return file;
  try {
    return await withSql(async (sql) => {
      const found = await sql.query<{
        site_id: string;
        photo_refs: unknown;
        photo_status: string;
        photo_diligence_count: string;
        photo_listing_count: string;
        photos_checked: string;
        photo_notes: string;
        facts: unknown;
      }>(
        `SELECT site_id, photo_refs, photo_status, photo_diligence_count, photo_listing_count, photos_checked, photo_notes, facts
         FROM sites WHERE site_id LIKE 'WB-%'`,
      );
      return paintUniverseMedia(file, found.rows);
    });
  } catch (error) {
    if (!missingTable(error)) {
      console.error(JSON.stringify({ event: "universe_media_error", name: error instanceof Error ? error.name : "error" }));
    }
    return file;
  }
}
