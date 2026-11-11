import { NextResponse } from "next/server";
import { isSession, privateHeaders, requireUser } from "@/lib/guard";
import { ndaQueueAllowed, ndaQueueBody } from "@/lib/nda";
import { loadNdaSnapshot } from "@/lib/ndaLoad";

export async function GET() {
  const session = await requireUser();
  if (!isSession(session)) return session;
  if (!ndaQueueAllowed(session.actionRole)) {
    return NextResponse.json({ error: "You do not have permission for that." }, { status: 403, headers: privateHeaders });
  }
  console.info(JSON.stringify({ event: "data", user: session.u, part: "nda" }));
  return NextResponse.json(ndaQueueBody(loadNdaSnapshot()), { headers: privateHeaders });
}
