import { isExcludedSite } from "@/lib/alerts/excluded";

const PRODUCTION_ORIGIN = "https://distributedsites.com";

export type FeedKind =
  | "note"
  | "reply"
  | "mention"
  | "suggestion"
  | "flag"
  | "decision"
  | "ask_gap"
  | "proposal_ready"
  | "proposal_overtaken"
  | "proposal_closed"
  | "data_change"
  | "check_failed"
  | "stale"
  | "broker_match";

export type DeepPanel = "discussion" | "proposal" | "activity" | "numbers" | "financials" | "intel";

export type DeepLink = {
  siteId: string;
  panel?: DeepPanel;
  msg?: string;
  pl?: "annual" | "monthly";
  kind?: FeedKind;
};

/** APP_URL when set, otherwise the production map. No trailing slash. */
export function configuredOrigin(): string {
  const explicit = (process.env.APP_URL || "").trim().replace(/\/$/, "");
  return explicit || PRODUCTION_ORIGIN;
}

function firstHeader(request: Request, name: string): string {
  return (request.headers.get(name) || "").split(",")[0].trim();
}

/**
 * Origin for a request. Canonical agent links do not use this. They stay on
 * https://distributedsites.com so a copied link never points at a preview host.
 */
export function feedOrigin(request?: Request): string {
  if (request) {
    const url = new URL(request.url);
    const host = firstHeader(request, "x-forwarded-host") || firstHeader(request, "host") || url.host;
    if (host) {
      const proto = firstHeader(request, "x-forwarded-proto") || url.protocol.replace(":", "") || "https";
      return `${proto}://${host}`.replace(/\/$/, "");
    }
  }
  return configuredOrigin();
}

function panelForKind(kind?: FeedKind): DeepPanel | "" {
  if (kind === "note" || kind === "reply" || kind === "mention") return "discussion";
  if (kind === "suggestion" || kind === "decision" || kind === "proposal_ready" || kind === "proposal_overtaken" || kind === "proposal_closed") return "proposal";
  if (kind === "check_failed") return "numbers";
  return "";
}

function sitePath(link: DeepLink): string {
  if (isExcludedSite(link.siteId)) return "";
  if (!link.siteId || link.siteId === "portfolio") return "/";
  const site = encodeURIComponent(link.siteId);
  if (link.kind === "flag" && !link.panel) return `/?view=review&site=${site}`;
  const panel = link.panel || panelForKind(link.kind);
  let path = `/?site=${site}`;
  if (panel) path += `&panel=${panel}`;
  if (link.msg && /^CM-\d{4,}$/.test(link.msg)) path += `&msg=${encodeURIComponent(link.msg)}`;
  if (link.pl === "annual" || link.pl === "monthly") path += `&pl=${link.pl}`;
  return path;
}

/** Canonical site URL. Always https://distributedsites.com. Empty for the quarantined site. */
export function feedSitePath(kind: FeedKind, siteId: string, extra?: { panel?: DeepPanel; msg?: string; pl?: "annual" | "monthly" }): string {
  return canonicalUrl({ siteId, kind, panel: extra?.panel, msg: extra?.msg, pl: extra?.pl });
}

export function canonicalUrl(link: DeepLink): string {
  const path = sitePath(link);
  if (!path) return "";
  return path === "/" ? `${PRODUCTION_ORIGIN}/` : `${PRODUCTION_ORIGIN}${path}`;
}

export function appPath(url: string): string {
  if (!url) return "";
  if (url === `${PRODUCTION_ORIGIN}/`) return "/";
  return url.startsWith(PRODUCTION_ORIGIN) ? url.slice(PRODUCTION_ORIGIN.length) : url;
}

export function resultUrl(docType: string, entityId: string, siteId: string): string {
  const site = siteId || (docType === "site" ? entityId : "");
  if (!site || isExcludedSite(site) || isExcludedSite(entityId)) return "";
  if (docType === "comms") return canonicalUrl({ siteId: site, panel: "activity", msg: entityId });
  if (docType === "note") return canonicalUrl({ siteId: site, panel: "discussion" });
  if (docType === "intel") return canonicalUrl({ siteId: site, panel: "intel" });
  if (docType === "pnl_line") return canonicalUrl({ siteId: site, panel: "financials", pl: "annual" });
  if (docType === "activity") return canonicalUrl({ siteId: site, panel: "activity" });
  return canonicalUrl({ siteId: site });
}

export function entityUrl(input: { kind: FeedKind; siteId: string; refId?: string; subtype?: string | null }): string {
  if (isExcludedSite(input.siteId)) return "";
  if (input.kind === "data_change" && input.subtype === "comms") {
    return canonicalUrl({ siteId: input.siteId, panel: "activity", msg: input.refId });
  }
  if (input.kind === "data_change" && input.subtype === "activity") return canonicalUrl({ siteId: input.siteId, panel: "activity" });
  if (input.kind === "data_change" && (input.subtype === "annual" || input.subtype === "monthly")) {
    return canonicalUrl({ siteId: input.siteId, panel: "financials", pl: input.subtype });
  }
  if (input.kind === "check_failed") return canonicalUrl({ siteId: input.siteId, panel: "numbers" });
  if (input.kind === "stale" || input.kind === "broker_match") return canonicalUrl({ siteId: input.siteId });
  return feedSitePath(input.kind, input.siteId);
}

/** Mail links keep a non-preview APP_URL. Agent feed links use feedSitePath instead. */
export function absoluteSiteUrl(origin: string, kind: FeedKind, siteId: string): string {
  const path = sitePath({ siteId, kind });
  if (!path) return "";
  const base = (origin || PRODUCTION_ORIGIN).replace(/\/$/, "");
  return path === "/" ? `${base}/` : `${base}${path}`;
}
