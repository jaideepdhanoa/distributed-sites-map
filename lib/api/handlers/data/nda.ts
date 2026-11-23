import { NextResponse } from "next/server";
import { agentFromAuthorization } from "@/lib/changes/auth";
import { isSession, privateHeaders, requireUser } from "@/lib/guard";
import { ndaQueueAllowed } from "@/lib/nda";
import { loadNdaSnapshot } from "@/lib/ndaLoad";
import { loadNdaQueue } from "@/lib/ndaStore";

function queueResponse(user: string) {
  console.info(JSON.stringify({ event: "data", user, part: "nda" }));
  const snapshot = loadNdaSnapshot();
  return loadNdaQueue(snapshot.register || []).then((queue) => NextResponse.json({
    source: snapshot.source,
    as_of: snapshot.as_of,
    label: snapshot.label,
    queue,
  }, { headers: privateHeaders }));
}

export async function GET(request: Request) {
  const header = request.headers.get("authorization") || "";
  if (header.trim()) {
    const actor = agentFromAuthorization(header);
    if (actor === "missing-env") {
      return NextResponse.json({ error: "Agent reads are off until AGENT_WRITE_TOKEN_INDIE or AGENT_WRITE_TOKEN_MUSE is set." }, { status: 401, headers: privateHeaders });
    }
    if (actor === "nomatch" || actor === "absent" || typeof actor === "string") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
    }
    return queueResponse(actor.id);
  }
  const session = await requireUser();
  if (!isSession(session)) return session;
  if (!ndaQueueAllowed(session.actionRole)) {
    return NextResponse.json({ error: "You do not have permission for that." }, { status: 403, headers: privateHeaders });
  }
  return queueResponse(session.u);
}
