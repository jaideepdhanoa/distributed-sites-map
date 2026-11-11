import { NextResponse } from "next/server";
import { commsBody } from "@/lib/comms";
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
  return NextResponse.json(commsBody(session.actionRole, loadCommsSnapshot(), ids), { headers: privateHeaders });
}
