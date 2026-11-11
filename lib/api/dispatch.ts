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
import * as agentInboxAck from "@/lib/api/handlers/agent/inbox-ack";
import * as agentInboxRecommendation from "@/lib/api/handlers/agent/inbox-recommendation";
import * as ask from "@/lib/api/handlers/ask";
import * as askStatus from "@/lib/api/handlers/ask-status";
import * as views from "@/lib/api/handlers/actions/views";
import * as viewsId from "@/lib/api/handlers/actions/views-id";
import * as digest from "@/lib/api/handlers/alerts/digest";
import * as flush from "@/lib/api/handlers/alerts/flush";
import * as preferences from "@/lib/api/handlers/alerts/preferences";
import * as alertTest from "@/lib/api/handlers/alerts/test";
import * as areas from "@/lib/api/handlers/data/areas";
import * as deals from "@/lib/api/handlers/data/deals";
import * as depots from "@/lib/api/handlers/data/depots";
import * as financialsId from "@/lib/api/handlers/data/financials-id";
import * as nda from "@/lib/api/handlers/data/nda";
import * as openLoops from "@/lib/api/handlers/data/open-loops";
import * as funnel from "@/lib/api/handlers/data/funnel";
import * as grid from "@/lib/api/handlers/data/grid";
import * as parcels from "@/lib/api/handlers/data/parcels";
import * as sites from "@/lib/api/handlers/data/sites";
import * as sitesId from "@/lib/api/handlers/data/sites-id";
import * as timeline from "@/lib/api/handlers/data/timeline";
import * as timelineSummary from "@/lib/api/handlers/data/timeline-summary";
import * as unscreened from "@/lib/api/handlers/data/unscreened";
import * as login from "@/lib/api/handlers/login";
import * as logout from "@/lib/api/handlers/logout";
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
  route("/api/agent/inbox/:id/recommendation", { POST: agentInboxRecommendation.POST as Handler }),
  route("/api/agent/inbox", { GET: agentInbox.GET as Handler }),
  route("/api/alerts/digest", { GET: digest.GET as Handler }),
  route("/api/alerts/flush", { GET: flush.GET as Handler, POST: flush.POST as Handler }),
  route("/api/alerts/preferences", { GET: preferences.GET as Handler, PUT: preferences.PUT as Handler }),
  route("/api/alerts/test", { POST: alertTest.POST as Handler }),
  route("/api/data/areas", { GET: areas.GET as Handler }),
  route("/api/data/deals", { GET: deals.GET as Handler }),
  route("/api/data/depots", { GET: depots.GET as Handler }),
  route("/api/data/financials/:id", { GET: financialsId.GET as Handler }),
  route("/api/data/nda", { GET: nda.GET as Handler }),
  route("/api/data/open-loops", { GET: openLoops.GET as Handler }),
  route("/api/data/funnel", { GET: funnel.GET as Handler }),
  route("/api/data/grid", { GET: grid.GET as Handler }),
  route("/api/data/parcels", { GET: parcels.GET as Handler }),
  route("/api/data/sites/:id", { GET: sitesId.GET as Handler }),
  route("/api/data/sites", { GET: sites.GET as Handler }),
  route("/api/data/timeline/summary", { GET: timelineSummary.GET as Handler }),
  route("/api/data/timeline", { GET: timeline.GET as Handler }),
  route("/api/data/unscreened", { GET: unscreened.GET as Handler }),
  route("/api/ask/status", { GET: askStatus.GET as Handler }),
  route("/api/ask", { POST: ask.POST as Handler }),
  route("/api/login", { POST: login.POST as Handler }),
  route("/api/logout", { POST: logout.POST as Handler }),
  route("/api/me", { GET: me.GET as Handler }),
  route("/api/queue/flag", { POST: queueFlag.POST as Handler }),
  route("/api/queue/follow", { POST: queueFollow.POST as Handler }),
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

export async function dispatch(method: string, request: NextRequest, parts: string[]): Promise<Response> {
  const found = findRoute(parts);
  if (!found) notFound();
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { Allow: allowHeader(Object.keys(found.route.methods)) } });
  }
  const handler = found.route.methods[method];
  if (!handler) return methodNotAllowed();
  return handler(request, { params: Promise.resolve({ id: found.id }) });
}
