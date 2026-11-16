import { actionsEnabled, withSql } from "@/lib/actions/db";
import { isExcludedSite } from "@/lib/alerts/excluded";
import { sinceLabel, type TagView } from "./map";
import { chipsFromDeal, presentChips } from "./show";
import { tagCode, tagFamily } from "./vocab";

type DealFeature = { properties?: Record<string, unknown> | null };

type StoredTag = {
  site_id: string;
  family: string;
  code: string;
  since_iso: string;
  source_ref: string;
  note: string;
  owner: string;
  due_on: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function storedView(row: StoredTag): TagView | null {
  if (isExcludedSite(row.site_id)) return null;
  const code = tagCode(row.family, row.code);
  const family = tagFamily(row.family);
  if (!code || !family) return null;
  return {
    family: row.family,
    code: row.code,
    label: code.label,
    tone: code.tone,
    help: code.help,
    since: sinceLabel(row.since_iso || ""),
    note: text(row.note),
    owner: text(row.owner),
    due: text(row.due_on),
    source: text(row.source_ref),
  };
}

/** Database chips replace the derived chip for the same family. Derived chips fill the rest. */
export function mergeChips(derived: TagView[], stored: TagView[]): TagView[] {
  const byFamily = new Map(derived.map((chip) => [chip.family, chip]));
  for (const chip of stored) byFamily.set(chip.family, chip);
  return [...byFamily.values()];
}

export async function overlayDealChips<T extends { features?: DealFeature[] }>(file: T, signedIn: boolean): Promise<T> {
  const features = file.features || [];
  let stored = new Map<string, TagView[]>();
  if (actionsEnabled()) {
    try {
      const rows = await withSql((sql) =>
        sql.query<StoredTag>(
          `SELECT site_id, family, code, since_iso, source_ref, note, owner, due_on FROM site_tags`,
        ),
      );
      stored = new Map();
      for (const row of rows.rows) {
        const chip = storedView(row);
        if (!chip) continue;
        const id = text(row.site_id).toUpperCase();
        const list = stored.get(id) || [];
        list.push(chip);
        stored.set(id, list);
      }
    } catch {
      console.error(JSON.stringify({ event: "tag_read_fallback" }));
    }
  }
  return {
    ...file,
    features: features.map((feature) => {
      const props = feature.properties || {};
      const id = text(props.deal_id).toUpperCase();
      if (isExcludedSite(id)) return feature;
      const derived = chipsFromDeal(props, signedIn);
      const chips = presentChips(mergeChips(derived, stored.get(id) || []), signedIn);
      return { ...feature, properties: { ...props, chips } };
    }),
  };
}
