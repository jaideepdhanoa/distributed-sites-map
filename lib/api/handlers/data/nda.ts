import { NextResponse } from "next/server";
import { agentFromAuthorization } from "@/lib/changes/auth";
import { overlayComms } from "@/lib/changes/read";
import { canSeeGmailLinks, type CommsRecord } from "@/lib/comms";
import { redactGmailPayload } from "@/lib/displayText";
import { loadCommsSnapshot } from "@/lib/commsLoad";
import { isSession, privateHeaders, requireUser } from "@/lib/guard";
import { coveredSites, ndaQueueAllowed } from "@/lib/nda";
import { ndaActivity } from "@/lib/ndaActivity";
import { loadNdaSnapshot } from "@/lib/ndaLoad";
import { loadNdaQueue } from "@/lib/ndaStore";
import { getUsers } from "@/lib/users";

function ownerNames(): Record<string, string> {
  const names: Record<string, string> = {};
  for (const user of getUsers()) {
    if (user.u && user.displayName) names[user.u] = user.displayName;
  }
  return names;
}

let commsCache: { at: number; rows: CommsRecord[] } | null = null;

async function commsRows(): Promise<CommsRecord[]> {
  if (commsCache && Date.now() - commsCache.at < 30_000) return commsCache.rows;
  const comms = await overlayComms(loadCommsSnapshot());
  commsCache = { at: Date.now(), rows: comms.rows || [] };
  return commsCache.rows;
}

function queueResponse(user: string) {
  console.info(JSON.stringify({ event: "data", user, part: "nda" }));
  const snapshot = loadNdaSnapshot();
  return loadNdaQueue(snapshot.register || []).then((queue) => {
    const names = ownerNames();
    return NextResponse.json({
      source: snapshot.source,
      as_of: snapshot.as_of,
      label: snapshot.label,
      queue: queue.map((row) => ({ ...row, owner_name: names[row.owner] || "" })),
    }, { headers: privateHeaders });
  });
}

async function activityResponse(user: string, ndaId: string) {
  console.info(JSON.stringify({ event: "data", user, part: "nda-activity" }));
  const snapshot = loadNdaSnapshot();
  const queue = await loadNdaQueue(snapshot.register || []);
  const row = queue.find((item) => item.nda_id.toUpperCase() === ndaId.toUpperCase());
  if (!row) return NextResponse.json({ items: [], contact_email: "" }, { headers: privateHeaders });
  const covered = coveredSites(row.site_ids || "");
  const refs = (row.covered_refs || []).filter((item) => /^(?:PIPE|LAND)-/i.test(item));
  const activity = ndaActivity(await commsRows(), {
    sites: [...covered.ids, ...refs],
    ndaId: row.nda_id,
    firm: row.counterparty_firm || "",
    person: row.contact_name || row.counterparty_person || "",
    threads: row.gmail_thread_ids || [],
    source: `${row.source || ""}\n${row.notes || ""}`,
  });
  if (!canSeeGmailLinks(user)) {
    for (const item of activity.items) item.href = "";
  }
  return NextResponse.json(redactGmailPayload({
    items: activity.items,
  }), { headers: privateHeaders });
}

export async function GET(request: Request) {
  const activityId = new URL(request.url).searchParams.get("activity") || "";
  const header = request.headers.get("authorization") || "";
  if (header.trim()) {
    const actor = agentFromAuthorization(header);
    if (actor === "missing-env") {
      return NextResponse.json({ error: "Agent reads are off until AGENT_WRITE_TOKEN_INDIE or AGENT_WRITE_TOKEN_MUSE is set." }, { status: 401, headers: privateHeaders });
    }
    if (actor === "nomatch" || actor === "absent" || typeof actor === "string") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
    }
    if (/^NDA-\d{3,}$/i.test(activityId)) return activityResponse(actor.id, activityId.toUpperCase());
    return queueResponse(actor.id);
  }
  const session = await requireUser();
  if (!isSession(session)) return session;
  if (!ndaQueueAllowed(session.actionRole)) {
    return NextResponse.json({ error: "You do not have permission for that." }, { status: 403, headers: privateHeaders });
  }
  if (/^NDA-\d{3,}$/i.test(activityId)) return activityResponse(session.u, activityId.toUpperCase());
  return queueResponse(session.u);
}
