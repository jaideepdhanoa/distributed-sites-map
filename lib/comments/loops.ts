import type { Sql } from "@/lib/actions/db";
import type { OpenLoop } from "@/lib/openLoops";
import { chipLabel, commentTagLabel } from "./anchor";
import { loadOpenThreads } from "./record";

function marketOf(siteId: string): string {
  const match = /^[A-Z]+-([A-Z]{3})-/.exec(siteId);
  return match?.[1] || "";
}

function daysSince(iso: string): number {
  const start = Date.parse(iso);
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, Math.floor((Date.now() - start) / 86_400_000));
}

/** Open anchored threads as open-loop rows. The comment text stays off this list. */
export async function commentLoops(sql: Sql): Promise<OpenLoop[]> {
  const rows = await loadOpenThreads(sql);
  return rows.map((row) => {
    const market = marketOf(row.siteId);
    const days = daysSince(row.createdAt);
    const asked = row.tag === "ask_broker";
    const tag = commentTagLabel(row.tag);
    return {
      loop_class: "Site" as const,
      id: row.id,
      folded_site_ids: [row.siteId],
      site_note: "",
      party: "",
      label: row.siteId,
      market,
      markets: market ? [market] : [],
      stage: "",
      court: asked ? "Them — broker" : "Us — diligence",
      days,
      detail: `Comment · ${chipLabel(row.anchor)}${tag ? ` · ${tag}` : ""}`,
      next_step: asked ? "Review the suggested question" : "Reply or resolve",
      owner: "Brief" as const,
      parked: false,
      brief_flagged: days > 7,
    };
  });
}
