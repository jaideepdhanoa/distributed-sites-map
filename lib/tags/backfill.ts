import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Sql } from "@/lib/actions/db";
import { isExcludedSite } from "@/lib/alerts/excluded";
import { applyBatch } from "@/lib/changes/apply";
import { isProductionDatabase } from "@/lib/changes/guard";
import type { Actor } from "@/lib/changes/schema";
import { SITE_ID } from "@/lib/changes/vocab";
import { findPolicyHits } from "@/lib/policy/banned";
import { mapTags, tagHash, type TagDraft, type TagRecord } from "./map";

const BACKFILL: Actor = { id: "backfill", kind: "agent" };
const SOURCE = "Column backfill";

export type TagBackfillPlan = {
  writes: (TagDraft & { siteId: string; hash: string; version: number })[];
  counts: { family: string; code: string; n: number }[];
  unmapped: { family: string; hash: string; n: number }[];
  kept: number;
  skipped: number;
  digest: string;
};

type Existing = { site_id: string; family: string };

function readJson(name: string): unknown {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), "data", "generated", name), "utf8")) as unknown;
  } catch {
    return null;
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function features(raw: unknown): Record<string, unknown>[] {
  if (!raw || typeof raw !== "object") return [];
  const list = (raw as { features?: { properties?: Record<string, unknown> }[] }).features;
  if (!Array.isArray(list)) return [];
  return list.map((feature) => feature.properties || {});
}

function sheetCells(value: unknown): Record<string, string> {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return {};
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const cells: Record<string, string> = {};
  for (const [key, cell] of Object.entries(parsed as Record<string, unknown>)) {
    const name = key.trim().toLowerCase();
    if (!name) continue;
    cells[name] = text(cell);
  }
  return cells;
}

function fromDeal(props: Record<string, unknown>): TagRecord {
  return {
    siteId: text(props.deal_id || props.site_id).toUpperCase(),
    market: text(props.city || props.market),
    stage: text(props.stage),
    stageReason: text(props.stage_reason || props.reason),
    blocker: text(props.stage_blocker),
    blockerSince: text(props.stage_blocker_since),
    nextStep: text(props.next_step),
    gapText: text(props.biggest_gap || props.gap),
    packageStatus: text(props.package_status),
    ndaStatus: text(props.nda_status),
    photoStatus: text(props.photo_status),
    sourceKind: text(props.source_kind),
    leadSource: text(props.lead_source),
    listed: props.listed === true,
    listingRemoved: props.listing_removed === true,
    figuresBasis: text(props.figures_basis),
    landBasis: text(props.land_acres_basis),
    powerNotes: text(props.cap_a_confidence),
    zoning: text(props.zoning),
    hasPrice: typeof props.asking_price === "number",
    excelRow: Number(props._excel_row) === 10 ? 10 : null,
  };
}

function mergeSheet(record: TagRecord, cells: Record<string, string>, pipelineRow: number | null): TagRecord {
  const cell = (name: string) => cells[name.toLowerCase()] || "";
  return {
    ...record,
    blocker: record.blocker || cell("stage blocker"),
    blockerSince: record.blockerSince || cell("stage blocker since"),
    nextStep: record.nextStep || cell("next step"),
    gapText: record.gapText || cell("biggest gap") || cell("what we know"),
    packageStatus: record.packageStatus || cell("package status"),
    photoStatus: record.photoStatus || cell("photo status"),
    leadSource: record.leadSource || cell("lead source"),
    listingStatus: record.listingStatus || cell("listing status"),
    stageReason: record.stageReason || cell("knock-out") || cell("ko reason"),
    excelRow: pipelineRow === 10 ? 10 : record.excelRow,
  };
}

export function planTagBackfill(records: TagRecord[], existing: Existing[]): TagBackfillPlan {
  const have = new Set(existing.map((row) => `${row.site_id.trim().toUpperCase()}:${row.family}`));
  const writes: TagBackfillPlan["writes"] = [];
  const unmapped = new Map<string, { family: string; hash: string; n: number }>();
  let kept = 0;
  let skipped = 0;
  const seen = new Set<string>();
  for (const record of records) {
    const siteId = text(record.siteId).toUpperCase();
    if (!siteId || seen.has(siteId)) continue;
    seen.add(siteId);
    if (!SITE_ID.test(siteId) || isExcludedSite(siteId) || record.excelRow === 10) {
      skipped += 1;
      continue;
    }
    const mapped = mapTags({ ...record, siteId });
    for (const item of mapped.unmapped) {
      const key = `${item.family}:${item.hash}`;
      const prior = unmapped.get(key);
      if (prior) prior.n += 1;
      else unmapped.set(key, { family: item.family, hash: item.hash, n: 1 });
    }
    for (const draft of mapped.drafts) {
      if (have.has(`${siteId}:${draft.family}`)) {
        kept += 1;
        continue;
      }
      writes.push({ ...draft, siteId, hash: tagHash(siteId), version: 0 });
    }
  }
  const counts = new Map<string, { family: string; code: string; n: number }>();
  for (const write of writes) {
    const key = `${write.family}:${write.code}`;
    const prior = counts.get(key);
    if (prior) prior.n += 1;
    else counts.set(key, { family: write.family, code: write.code, n: 1 });
  }
  const countRows = [...counts.values()].sort((a, b) => a.family.localeCompare(b.family) || a.code.localeCompare(b.code));
  const unmappedRows = [...unmapped.values()].sort((a, b) => a.family.localeCompare(b.family) || a.hash.localeCompare(b.hash));
  writes.sort((a, b) => a.hash.localeCompare(b.hash) || a.family.localeCompare(b.family));
  const digest = createHash("sha256")
    .update(writes.map((row) => `${row.hash}:${row.family}:${row.code}`).join("\n"))
    .digest("hex")
    .slice(0, 16);
  return { writes, counts: countRows, unmapped: unmappedRows, kept, skipped, digest };
}

/** Counts, code names, and hashed ids. Cell text and site ids stay out. */
export function formatTagBackfill(plan: TagBackfillPlan): string {
  const lines = [
    `writes ${plan.writes.length}`,
    `kept ${plan.kept}`,
    `skipped ${plan.skipped}`,
    `unmapped ${plan.unmapped.reduce((sum, row) => sum + row.n, 0)}`,
  ];
  for (const row of plan.counts) lines.push(`count ${row.family} ${row.code} ${row.n}`);
  for (const row of plan.unmapped) lines.push(`unmapped ${row.family} #${row.hash} ${row.n}`);
  return lines.join("\n");
}

export function assertTagBackfillApply(url: string, confirm: string | undefined): void {
  if ((confirm || "").trim() !== "backfill-tags") {
    throw new Error("Refusing to backfill tags. Dry run is the default. Set CONFIRM=backfill-tags to apply.");
  }
  if (isProductionDatabase(url)) {
    throw new Error("Refusing to backfill tags on the production database.");
  }
}

export async function loadTagBackfill(sql: Sql | null): Promise<TagBackfillPlan> {
  const byId = new Map<string, TagRecord>();
  for (const props of features(readJson("deals.geojson"))) {
    const record = fromDeal(props);
    if (record.siteId) byId.set(record.siteId, record);
  }
  for (const props of features(readJson("sites.geojson"))) {
    const id = text(props.site_id).toUpperCase();
    if (!id || byId.has(id)) continue;
    byId.set(id, {
      siteId: id,
      market: text(props.city),
      operating: text(props.operating),
      photoStatus: text(props.photo_status),
      listed: props.listed === true,
      leadSource: text(props.lead_source),
      zoning: text(props.zoning),
    });
  }
  let existing: Existing[] = [];
  if (sql) {
    try {
      const stages = await sql.query<{ site_id: string; stage: string; reason: string; market: string }>(
        `SELECT site_id, stage, reason, market FROM site_stages`,
      );
      for (const row of stages.rows) {
        const id = text(row.site_id).toUpperCase();
        const current = byId.get(id) || { siteId: id };
        current.stage = current.stage || text(row.stage);
        current.stageReason = current.stageReason || text(row.reason);
        current.market = current.market || text(row.market);
        byId.set(id, current);
      }
    } catch {
      // Frozen rows still plan when the stage table is absent.
    }
    try {
      const sites = await sql.query<{ site_id: string; market: string; sheet: unknown; photo_status: string; listing_status: string }>(
        `SELECT site_id, market, sheet, photo_status, listing_status FROM sites`,
      );
      for (const row of sites.rows) {
        const id = text(row.site_id).toUpperCase();
        const current = byId.get(id) || { siteId: id };
        const merged = mergeSheet(
          { ...current, market: current.market || text(row.market), photoStatus: current.photoStatus || text(row.photo_status), listingStatus: text(row.listing_status) },
          sheetCells(row.sheet),
          null,
        );
        byId.set(id, merged);
      }
    } catch {
      // Frozen rows still plan when the site table is absent.
    }
    try {
      const tags = await sql.query<Existing>(`SELECT site_id, family FROM site_tags`);
      existing = tags.rows;
    } catch {
      existing = [];
    }
  }
  return planTagBackfill([...byId.values()], existing);
}

export async function applyTagBackfill(sql: Sql, plan: TagBackfillPlan): Promise<number> {
  let written = 0;
  for (let index = 0; index < plan.writes.length; index += 40) {
    const batch = plan.writes.slice(index, index + 40);
    await applyBatch(sql, BACKFILL, `tag-backfill-${plan.digest}-${index}`, {
      changes: batch.map((row) => ({
        entity_type: "tag" as const,
        site_id: row.siteId,
        expected_version: row.version,
        source: SOURCE,
        payload: {
          family: row.family,
          code: row.code,
          ...(row.sinceIso ? { since: row.sinceIso } : {}),
          ...(row.sourceRef ? { source_ref: row.sourceRef } : {}),
          ...(row.note && !findPolicyHits(row.note) ? { note: row.note.slice(0, 400) } : {}),
          ...(row.owner ? { owner: row.owner } : {}),
          ...(row.due ? { due_on: row.due } : {}),
        },
      })),
    });
    written += batch.length;
  }
  return written;
}

export async function readTagBackfillCounts(sql: Sql): Promise<{ family: string; code: string; n: number }[]> {
  const rows = await sql.query<{ family: string; code: string; n: number | string }>(
    `SELECT family, code, count(*)::int AS n FROM site_tags GROUP BY family, code ORDER BY family, code`,
  );
  return rows.rows.map((row) => ({ family: row.family, code: row.code, n: Number(row.n) }));
}
