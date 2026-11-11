import { NextResponse } from "next/server";
import { isSession, privateHeaders, requireUser } from "@/lib/guard";
import { ndaQueueAllowed } from "@/lib/nda";
import { openLoopsBody } from "@/lib/openLoops";
import { loadOpenLoops } from "@/lib/openLoopsLoad";

export async function GET() {
  const session = await requireUser();
  if (!isSession(session)) return session;
  if (!ndaQueueAllowed(session.actionRole)) {
    return NextResponse.json({ error: "You do not have permission for that." }, { status: 403, headers: privateHeaders });
  }
  console.info(JSON.stringify({ event: "data", user: session.u, part: "open-loops" }));
  return NextResponse.json(openLoopsBody(loadOpenLoops()), { headers: privateHeaders });
}
