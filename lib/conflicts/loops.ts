import type { Sql } from "@/lib/actions/db";
import type { OpenLoop } from "@/lib/openLoops";
import { loadOpenConflicts } from "./record";
import { statusLabel, type DataConflict } from "./view";

function marketOf(siteId: string): string {
  const match = /^[A-Z]+-([A-Z]{3})-/.exec(siteId);
  return match?.[1] || "";
}

function daysSince(iso: string): number {
  const start = Date.parse(iso);
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, Math.floor((Date.now() - start) / 86_400_000));
}

function loop(row: DataConflict): OpenLoop {
  const market = marketOf(row.siteId);
  const days = daysSince(row.createdAt);
  const where = row.period ? `${row.field} · ${row.period}` : row.field;
  return {
    loop_class: "Site",
    id: row.id,
    folded_site_ids: [row.siteId],
    site_note: "",
    party: "",
    label: row.siteId,
    market,
    markets: market ? [market] : [],
    stage: "",
    court: row.status === "asked_broker" ? "Them — broker" : "Us — diligence",
    days,
    detail: `Data conflict · ${where} · ${statusLabel(row.status)}`,
    next_step: row.status === "asked_broker" ? "Waiting on the broker" : "Choose the value in use",
    owner: "Brief",
    parked: false,
    brief_flagged: days > 7,
  };
}

/** Open conflicts as open-loop rows. Detail names the field and status, not either value. */
export async function conflictLoops(sql: Sql): Promise<OpenLoop[]> {
  const rows = await loadOpenConflicts(sql);
  return rows.map(loop);
}
