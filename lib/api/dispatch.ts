import * as decision from "@/lib/api/handlers/actions/comparison-decision";
import * as evidence from "@/lib/api/handlers/actions/comparison-evidence";
import * as work from "@/lib/api/handlers/actions/work";
import { notFound } from "next/navigation";
import type { NextRequest } from "next/server";
import * as accounts from "@/lib/api/handlers/actions/accounts";
import * as audit from "@/lib/api/handlers/actions/audit";
import * as exportsRoute from "@/lib/api/handlers/actions/exports";
import * as notes from "@/lib/api/handlers/actions/notes";
import * as notesId from "@/lib/api/handlers/actions/notes-id";
import * as notesReopen from "@/lib/api/handlers/actions/notes-reopen";
import * as notesResolve from "@/lib/api/handlers/actions/notes-resolve";
import * as status from "@/lib/api/handlers/actions/status";
import * as suggestions from "@/lib/api/handlers/actions/suggestions";
import * as suggestionsExport from "@/lib/api/handlers/actions/suggestions-export";
import * as suggestionsId from "@/lib/api/handlers/actions/suggestions-id";
import * as suggestionsDone from "@/lib/api/handlers/actions/suggestions-done";
import * as recommendations from "@/lib/api/handlers/actions/recommendations";
import * as recommendationsDismiss from "@/lib/api/handlers/actions/recommendations-dismiss";
import * as agentInbox from "@/lib/api/handlers/agent/inbox";
import * as agentSearch from "@/lib/api/handlers/agent/search";
import * as agentSite from "@/lib/api/handlers/agent/sites-id";
import * as cronSearch from "@/lib/api/handlers/cron/search";
import * as cronStale from "@/lib/api/handlers/cron/stale";
import * as search from "@/lib/api/handlers/search";
import * as agentInboxAck from "@/lib/api/handlers/agent/inbox-ack";
import * as agentInboxRecommendation from "@/lib/api/handlers/agent/inbox-recommendation";
import * as ask from "@/lib/api/handlers/ask";
import * as askStatus from "@/lib/api/handlers/ask-status";
import * as changes from "@/lib/api/handlers/changes";
import * as views from "@/lib/api/handlers/actions/views";
import * as viewsId from "@/lib/api/handlers/actions/views-id";
import * as digest from "@/lib/api/handlers/alerts/digest";
import * as flush from "@/lib/api/handlers/alerts/flush";
import * as alertFlushCron from "@/lib/api/handlers/cron/alert-flush";
import * as workbookSyncCron from "@/lib/api/handlers/cron/workbook-sync";
import * as preferences from "@/lib/api/handlers/alerts/preferences";
import * as alertTest from "@/lib/api/handlers/alerts/test";
import { previewDatabaseWriteResponse } from "@/lib/preview/block";
import { previewPointsAtProduction } from "@/lib/preview/safety";
import { primeSnapshot } from "@/lib/snapshot/read";
import * as areas from "@/lib/api/handlers/data/areas";
import * as deals from "@/lib/api/handlers/data/deals";
import * as depots from "@/lib/api/handlers/data/depots";
import * as financialsId from "@/lib/api/handlers/data/financials-id";
import * as comms from "@/lib/api/handlers/data/comms";
import * as nda from "@/lib/api/handlers/data/nda";
import * as openLoops from "@/lib/api/handlers/data/open-loops";
import * as funnel from "@/lib/api/handlers/data/funnel";
import * as grid from "@/lib/api/handlers/data/grid";
import * as parcels from "@/lib/api/handlers/data/parcels";
import * as revalidate from "@/lib/api/handlers/data/revalidate";
import * as sites from "@/lib/api/handlers/data/sites";
import * as sitesId from "@/lib/api/handlers/data/sites-id";
import * as selectionReview from "@/lib/api/handlers/data/selection-review";
import * as spaceOptions from "@/lib/api/handlers/data/space-options";
import * as spaces from "@/lib/api/handlers/data/spaces";
import * as timeline from "@/lib/api/handlers/data/timeline";
import * as timelineSummary from "@/lib/api/handlers/data/timeline-summary";
import * as unscreened from "@/lib/api/handlers/data/unscreened";
import * as login from "@/lib/api/handlers/login";
import * as logout from "@/lib/api/handlers/logout";
import * as listLayout from "@/lib/api/handlers/list/layout";
import * as me from "@/lib/api/handlers/me";
import * as queue from "@/lib/api/handlers/queue";
import * as queueFlag from "@/lib/api/handlers/queue/flag";
import * as queueFollow from "@/lib/api/handlers/queue/follow";
import * as queueMentions from "@/lib/api/handlers/queue/mentions";
import * as queueSnooze from "@/lib/api/handlers/queue/snooze";

type Handler = (
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) => Promise<Response> | Response;

type Segment = string | ":id";

export type ApiRoute = {
  path: string;
  parts: Segment[];
  methods: Record<string, Handler>;
};

function route(path: string, methods: Record<string, Handler>): ApiRoute {
  // The catch-all lives at app/api/[...route], so params omit the leading "api".
  return {
    path,
    parts: path.split("/").filter(Boolean).slice(1).map((part) => (part === ":id" ? ":id" : part)),
    methods,
  };
}

// Static siblings of a :id segment are listed first so they are not captured as ids.
export const apiRoutes: ApiRoute[] = [
  route("/api/actions/accounts", { GET: accounts.GET as Handler }),
  route("/api/actions/audit", { GET: audit.GET as Handler }),
  route("/api/actions/exports", { POST: exportsRoute.POST as Handler }),
  route("/api/actions/notes/:id/reopen", { POST: notesReopen.POST as Handler }),
  route("/api/actions/notes/:id/resolve", { POST: notesResolve.POST as Handler }),
  route("/api/actions/notes/:id", { PATCH: notesId.PATCH as Handler, DELETE: notesId.DELETE as Handler }),
  route("/api/actions/comparison-decision", { GET: decision.GET as Handler, POST: decision.POST as Handler }),
  route("/api/actions/comparison-evidence", { GET: evidence.GET as Handler, POST: evidence.POST as Handler }),
  route("/api/actions/work", { GET: work.GET as Handler }),
  route("/api/actions/notes", { GET: notes.GET as Handler, POST: notes.POST as Handler }),
  route("/api/actions/status", { GET: status.GET as Handler }),
  route("/api/actions/suggestions/export", { GET: suggestionsExport.GET as Handler }),
  route("/api/actions/suggestions/:id/done", { POST: suggestionsDone.POST as Handler }),
  route("/api/actions/suggestions/:id", { POST: suggestionsId.POST as Handler, PATCH: suggestionsId.PATCH as Handler }),
  route("/api/actions/suggestions", { GET: suggestions.GET as Handler, POST: suggestions.POST as Handler }),
  route("/api/actions/recommendations/:id/dismiss", { POST: recommendationsDismiss.POST as Handler }),
  route("/api/actions/recommendations", { GET: recommendations.GET as Handler }),
  route("/api/actions/views/:id", { DELETE: viewsId.DELETE as Handler }),
  route("/api/actions/views", { GET: views.GET as Handler, POST: views.POST as Handler }),
  route("/api/agent/inbox/ack", { POST: agentInboxAck.POST as Handler }),
  route("/api/agent/search", { GET: agentSearch.GET as Handler }),
  route("/api/agent/sites/:id", { GET: agentSite.GET as Handler }),
  route("/api/agent/inbox/:id/recommendation", { POST: agentInboxRecommendation.POST as Handler }),
  route("/api/agent/inbox", { GET: agentInbox.GET as Handler }),
  route("/api/alerts/digest", { GET: digest.GET as Handler }),
  route("/api/alerts/flush", { GET: flush.GET as Handler, POST: flush.POST as Handler }),
  route("/api/cron/alert-flush", { GET: alertFlushCron.GET as Handler }),
  route("/api/cron/workbook-sync", { GET: workbookSyncCron.GET as Handler }),
  route("/api/alerts/preferences", { GET: preferences.GET as Handler, PUT: preferences.PUT as Handler }),
  route("/api/alerts/test", { POST: alertTest.POST as Handler }),
  route("/api/data/areas", { GET: areas.GET as Handler }),
  route("/api/data/deals", { GET: deals.GET as Handler }),
  route("/api/data/depots", { GET: depots.GET as Handler }),
  route("/api/data/financials/:id", { GET: financialsId.GET as Handler }),
  route("/api/data/comms", { GET: comms.GET as Handler }),
  route("/api/data/nda", { GET: nda.GET as Handler }),
  route("/api/data/open-loops", { GET: openLoops.GET as Handler }),
  route("/api/data/funnel", { GET: funnel.GET as Handler }),
  route("/api/data/grid", { GET: grid.GET as Handler }),
  route("/api/data/parcels", { GET: parcels.GET as Handler }),
  route("/api/data/revalidate", { POST: revalidate.POST as Handler }),
  route("/api/data/sites/:id", { GET: sitesId.GET as Handler }),
  route("/api/data/sites", { GET: sites.GET as Handler }),
  route("/api/data/selection-review", { GET: selectionReview.GET as Handler }),
  route("/api/data/space-options", { GET: spaceOptions.GET as Handler, POST: spaceOptions.POST as Handler }),
  route("/api/data/spaces", { GET: spaces.GET as Handler }),
  route("/api/data/timeline/summary", { GET: timelineSummary.GET as Handler }),
  route("/api/data/timeline", { GET: timeline.GET as Handler }),
  route("/api/data/unscreened", { GET: unscreened.GET as Handler }),
  route("/api/cron/search", { GET: cronSearch.GET as Handler }),
  route("/api/cron/stale", { GET: cronStale.GET as Handler }),
  route("/api/search", { GET: search.GET as Handler }),
  route("/api/ask/status", { GET: askStatus.GET as Handler }),
  route("/api/ask", { POST: ask.POST as Handler }),
  route("/api/changes", { POST: changes.POST as Handler }),
  route("/api/list/layout", { GET: listLayout.GET as Handler, PUT: listLayout.PUT as Handler }),
  route("/api/login", { POST: login.POST as Handler }),
  route("/api/logout", { POST: logout.POST as Handler }),
  route("/api/me", { GET: me.GET as Handler }),
  route("/api/queue/flag", { POST: queueFlag.POST as Handler }),
  route("/api/queue/follow", { GET: queueFollow.GET as Handler, POST: queueFollow.POST as Handler }),
  route("/api/queue/mentions", { POST: queueMentions.POST as Handler }),
  route("/api/queue/snooze", { POST: queueSnooze.POST as Handler }),
  route("/api/queue", { GET: queue.GET as Handler, POST: queue.POST as Handler }),
];

function findRoute(parts: string[]): { route: ApiRoute; id: string } | null {
  for (const candidate of apiRoutes) {
    if (candidate.parts.length !== parts.length) continue;
    let id = "";
    let matched = true;
    for (let index = 0; index < candidate.parts.length; index += 1) {
      const want = candidate.parts[index];
      if (want === ":id") id = parts[index];
      else if (want !== parts[index]) {
        matched = false;
        break;
      }
    }
    if (matched) return { route: candidate, id };
  }
  return null;
}

// Same Allow list Next generates when a route file exports only these methods.
export function allowHeader(methods: string[]): string {
  const allow = new Set<string>(["OPTIONS", ...methods]);
  if (methods.includes("GET")) allow.add("HEAD");
  return [...allow].sort().join(", ");
}

function methodNotAllowed(): Response {
  return new Response(null, { status: 405 });
}

export function blocksPreviewWrite(method: string, parts: string[]): boolean {
  if (!previewPointsAtProduction()) return false;
  // The list layout handler answers 200 and keeps the browser layout.
  if (parts[0] === "list" && parts[1] === "layout") return false;
  if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") return true;
  if (method !== "GET") return false;
  if (parts[0] === "cron") return true;
  return parts[0] === "alerts" && (parts[1] === "digest" || parts[1] === "flush");
}

export async function dispatch(method: string, request: NextRequest, parts: string[]): Promise<Response> {
  const found = findRoute(parts);
  if (!found) notFound();
  if (blocksPreviewWrite(method, parts)) {
    const blocked = previewDatabaseWriteResponse();
    if (blocked) return blocked;
  }
  // Refreshing the cache must not read the snapshot it is about to drop.
  // Cron dispatch only talks to GitHub. A snapshot read must not block it.
  const skipPrime = (parts[0] === "data" && parts[1] === "revalidate") || parts[0] === "cron";
  if (method !== "OPTIONS" && !skipPrime) await primeSnapshot();
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { Allow: allowHeader(Object.keys(found.route.methods)) } });
  }
  const handler = found.route.methods[method];
  if (!handler) return methodNotAllowed();
  return handler(request, { params: Promise.resolve({ id: found.id }) });
}
