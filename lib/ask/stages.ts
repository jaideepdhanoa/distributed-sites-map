import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readGenerated } from "@/lib/guard";
import { summaryRecords } from "@/lib/timeline/filter";

const QUARANTINE_ID = "PIPE-PHX-0006";

const MARKETS: Record<string, string> = {
  PHX: "Phoenix",
  LAS: "Las Vegas",
  MIA: "Miami",
};

/** Furthest along first. Dropped deals are not in this list. */
const STAGE_RANK: Record<string, number> = {
  close: 0,
  checks: 1,
  financial: 2,
  desk: 3,
  contacted: 4,
  sourced: 5,
  later: 6,
};

export type StageRow = {
  id: string;
  name: string;
  market: string;
  stage: string;
  lastActivity: string;
};

function lastActivityById(): Record<string, string> {
  try {
    const raw = JSON.parse(readFileSync(join(process.cwd(), "data", "generated", "timeline.json"), "utf8"));
    const records = summaryRecords(raw);
    const out: Record<string, string> = {};
    for (const [id, record] of Object.entries(records)) out[id] = record.lastTouched;
    return out;
  } catch {
    return {};
  }
}

function labelFor(props: Record<string, unknown>, id: string): string {
  const name = String(props.name || "").trim();
  const address = String(props.address || "").trim();
  if (name && address && !name.includes(address)) {
    const combined = `${name}, ${address}`;
    return combined.length <= 80 ? combined : name;
  }
  return name || address || id;
}

/** Every listed deal that is still in play. Quarantined ids are left out. No prices or financial figures. */
export function listedStageRows(extraBlocked?: (id: string) => boolean): StageRow[] {
  let features: { properties?: Record<string, unknown> }[] = [];
  try {
    const file = readGenerated("deals.geojson") as { features?: { properties?: Record<string, unknown> }[] };
    features = file.features || [];
  } catch {
    features = [];
  }
  const activity = lastActivityById();
  const rows: StageRow[] = [];
  for (const feature of features) {
    const props = feature.properties || {};
    const id = String(props.deal_id || "").trim();
    if (!id || props.listed !== true || props.stage_group === "dropped") continue;
    if (id === QUARANTINE_ID || extraBlocked?.(id)) continue;
    const city = String(props.city || "");
    rows.push({
      id,
      name: labelFor(props, id),
      market: MARKETS[city] || city,
      stage: String(props.stage || props.stage_group || ""),
      lastActivity: activity[id] || "",
    });
  }
  rows.sort((a, b) => {
    const rankA = STAGE_RANK[groupOf(a.stage)] ?? 9;
    const rankB = STAGE_RANK[groupOf(b.stage)] ?? 9;
    if (rankA !== rankB) return rankA - rankB;
    if (a.market !== b.market) return a.market.localeCompare(b.market);
    return a.id.localeCompare(b.id);
  });
  return rows;
}

function groupOf(stage: string): string {
  const text = stage.toLowerCase();
  if (text.includes("offer") || text.includes("close")) return "close";
  if (text.includes("site check") || text.includes("checks")) return "checks";
  if (text.includes("financial")) return "financial";
  if (text.includes("desk")) return "desk";
  if (text.includes("contact")) return "contacted";
  if (text.includes("later")) return "later";
  if (text.includes("sourced")) return "sourced";
  return "";
}

export function filterStageRows(rows: StageRow[], market?: string, stage?: string): StageRow[] {
  const marketNeedle = (market || "").trim().toLowerCase();
  const stageNeedle = (stage || "").trim().toLowerCase();
  const marketName = marketNeedle === "phx" || marketNeedle === "phoenix"
    ? "phoenix"
    : marketNeedle === "las" || marketNeedle === "las vegas" || marketNeedle === "vegas"
      ? "las vegas"
      : marketNeedle === "mia" || marketNeedle === "miami"
        ? "miami"
        : marketNeedle;
  return rows.filter((row) => {
    if (marketName && row.market.toLowerCase() !== marketName) return false;
    if (stageNeedle && !row.stage.toLowerCase().includes(stageNeedle)) return false;
    return true;
  });
}

export function stageTableText(rows: StageRow[]): string {
  const lines = rows.map((row) => `${row.id} | ${row.name} | ${row.market} | ${row.stage} | ${row.lastActivity || "none"}`);
  return [
    "In-play listed deals, furthest along first (Offer and close, then Site checks, Financial screen, Desk screen, then earlier).",
    "Columns: id | name | market | stage | last activity. Dropped deals are omitted. Quarantined records are omitted. This table has no financial figures.",
    ...lines,
  ].join("\n");
}
