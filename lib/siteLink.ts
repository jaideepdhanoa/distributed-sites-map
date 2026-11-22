import { isProtectedId } from "@/lib/protectedSite";

const UNIVERSE_ID = /^WB-([A-Z]{2,4})-\d+$/;
const PIPE_ID = /^PIPE-[A-Z]{2,4}-\d+$/;
const LAND_ID = /^LAND-[A-Z]{2,4}-\d+$/;

export type SiteLink =
  | { kind: "pipeline"; id: string }
  | { kind: "universe"; id: string; market: "PHX" | "LAS" | "MIA" | null }
  | { kind: "missing"; id: string };

/** A counted Universe id, or the Pipeline deal it was promoted into. */
export function resolveSiteLink(
  id: string,
  deals: { deal_id?: string | null; universe_id?: string | null; kind?: string | null }[],
): SiteLink {
  if (!id || isProtectedId(id)) return { kind: "missing", id };
  if (PIPE_ID.test(id) || LAND_ID.test(id)) return { kind: "pipeline", id };
  const match = UNIVERSE_ID.exec(id);
  if (!match) return { kind: "missing", id };
  const promoted = deals.find((deal) =>
    deal.kind === "pipeline"
    && deal.universe_id === id
    && deal.deal_id
    && PIPE_ID.test(deal.deal_id)
    && !isProtectedId(deal.deal_id),
  );
  if (promoted?.deal_id) return { kind: "pipeline", id: promoted.deal_id };
  const market = match[1] === "PHX" || match[1] === "LAS" || match[1] === "MIA" ? match[1] : null;
  return { kind: "universe", id, market };
}

/** `https://host/?site=WB-LAS-0062`. The id is the only query field. */
export function siteHref(origin: string, id: string): string {
  const root = origin.replace(/\/$/, "");
  return `${root}/?site=${encodeURIComponent(id)}`;
}
