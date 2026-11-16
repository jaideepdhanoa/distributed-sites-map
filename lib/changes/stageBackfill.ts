import { createHash } from "node:crypto";
import type { Sql } from "@/lib/actions/db";
import { isExcludedSite } from "@/lib/alerts/excluded";
import { applyBatch } from "./apply";
import { isProductionDatabase } from "./guard";
import { formatZonedTimestamp, type Actor } from "./schema";
import { shortHash } from "./site";
import { canonicalStageName, marketCode, serviceAreaCode } from "./stageLabel";
import { SITE_ID, type CanonicalStage, type Market } from "./vocab";

const SYSTEM: Actor = { id: "system", kind: "agent" };
const INSERT_SOURCE = "Initial stage for new capture";
const NORMALIZE_SOURCE = "Legacy stage normalization";
const INITIAL_STAGE: CanonicalStage = "1 Desk screen";

export type StageBackfillItem = {
  siteId: string;
  hash: string;
  action: "insert" | "normalize";
  stage: CanonicalStage;
  market: Market;
  serviceArea: string;
  version: number;
};

export type StageBackfillPlan = {
  inserts: StageBackfillItem[];
  normalizes: StageBackfillItem[];
  skipped: string[];
  digest: string;
};

type StageRow = { site_id: string; stage: string; market: string; service_area_class: string; version: number | string };
type SiteRow = { site_id: string; market: string; service_area_class: string };

function item(siteId: string, action: StageBackfillItem["action"], stage: CanonicalStage, market: Market, serviceArea: string, version: number): StageBackfillItem {
  return { siteId, hash: shortHash(siteId), action, stage, market, serviceArea, version };
}

/** Missing stage rows become Desk screen. Unnumbered labels become the numbered stage. Dropped is never written. */
export function planStageBackfill(sites: SiteRow[], stages: StageRow[]): StageBackfillPlan {
  const staged = new Set<string>();
  const inserts: StageBackfillItem[] = [];
  const normalizes: StageBackfillItem[] = [];
  const skipped: string[] = [];
  for (const row of stages) {
    const siteId = row.site_id.trim().toUpperCase();
    if (!SITE_ID.test(siteId) || isExcludedSite(siteId)) continue;
    staged.add(siteId);
    const next = canonicalStageName(row.stage);
    if (!next || next === row.stage || next === "Dropped") continue;
    const market = marketCode(row.market, siteId);
    if (!market) {
      skipped.push(shortHash(siteId));
      continue;
    }
    normalizes.push(item(siteId, "normalize", next, market, serviceAreaCode(row.service_area_class), Number(row.version)));
  }
  for (const row of sites) {
    const siteId = row.site_id.trim().toUpperCase();
    if (!SITE_ID.test(siteId) || isExcludedSite(siteId) || staged.has(siteId)) continue;
    const market = marketCode(row.market, siteId);
    if (!market) {
      skipped.push(shortHash(siteId));
      continue;
    }
    inserts.push(item(siteId, "insert", INITIAL_STAGE, market, serviceAreaCode(row.service_area_class), 0));
  }
  const rank = (row: StageBackfillItem) => row.hash;
  inserts.sort((a, b) => rank(a).localeCompare(rank(b)));
  normalizes.sort((a, b) => rank(a).localeCompare(rank(b)));
  skipped.sort();
  const digest = createHash("sha256")
    .update([...inserts, ...normalizes].map((row) => `${row.action}:${row.hash}:${row.stage}`).join("\n"))
    .digest("hex")
    .slice(0, 16);
  return { inserts, normalizes, skipped, digest };
}

export async function loadStageBackfill(sql: Sql): Promise<StageBackfillPlan> {
  const sites = await sql.query<SiteRow>(`SELECT site_id, market, service_area_class FROM sites`);
  const stages = await sql.query<StageRow>(`SELECT site_id, stage, market, service_area_class, version FROM site_stages`);
  return planStageBackfill(sites.rows, stages.rows);
}

/** Counts and hashed ids only. Stage text and site ids stay out of the log. */
export function formatStageBackfill(plan: StageBackfillPlan): string {
  const lines = [`insert ${plan.inserts.length}`, `normalize ${plan.normalizes.length}`, `skipped ${plan.skipped.length}`];
  for (const row of plan.inserts) lines.push(`- insert #${row.hash}`);
  for (const row of plan.normalizes) lines.push(`- normalize #${row.hash}`);
  for (const hash of plan.skipped) lines.push(`- skipped #${hash}`);
  return lines.join("\n");
}

export function assertStageBackfillApply(url: string, confirm: string | undefined): void {
  if ((confirm || "").trim() !== "backfill-stages") {
    throw new Error("Refusing to backfill stages. Dry run is the default. Set CONFIRM=backfill-stages to apply.");
  }
  if (isProductionDatabase(url)) {
    throw new Error("Refusing to backfill stages on the production database.");
  }
}

export async function applyStageBackfill(sql: Sql, plan: StageBackfillPlan): Promise<number> {
  const at = formatZonedTimestamp();
  const changes = [...plan.inserts, ...plan.normalizes].map((row) => ({
    entity_type: "stage" as const,
    site_id: row.siteId,
    expected_version: row.version,
    source: row.action === "insert" ? INSERT_SOURCE : NORMALIZE_SOURCE,
    payload: {
      stage: row.stage,
      market: row.market,
      ...(row.serviceArea ? { service_area_class: row.serviceArea } : {}),
      at,
    },
  }));
  let written = 0;
  for (let index = 0; index < changes.length; index += 100) {
    const batch = changes.slice(index, index + 100);
    await applyBatch(sql, SYSTEM, `stage-backfill-${plan.digest}-${index}`, { changes: batch });
    written += batch.length;
  }
  return written;
}
