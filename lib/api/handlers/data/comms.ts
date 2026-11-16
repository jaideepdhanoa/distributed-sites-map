import { NextResponse } from "next/server";
import { overlayComms } from "@/lib/changes/read";
import { commsForViewer } from "@/lib/comms";
import { redactGmailPayload } from "@/lib/displayText";
import { loadCommsSnapshot } from "@/lib/commsLoad";
import { isSession, privateHeaders, requireUser } from "@/lib/guard";
import { ndaQueueAllowed } from "@/lib/nda";

export async function GET(request: Request) {
  const session = await requireUser();
  if (!isSession(session)) return session;
  if (!ndaQueueAllowed(session.actionRole)) {
    return NextResponse.json({ error: "You do not have permission for that." }, { status: 403, headers: privateHeaders });
  }
  const url = new URL(request.url);
  const ids = [url.searchParams.get("id") || "", url.searchParams.get("related") || ""];
  console.info(JSON.stringify({ event: "data", user: session.u, part: "comms" }));
  const snapshot = await overlayComms(loadCommsSnapshot(), ids);
  return NextResponse.json(redactGmailPayload(commsForViewer(session.actionRole, session.u, snapshot, ids)), { headers: privateHeaders });
}
