import { NextResponse } from "next/server";
import { isSession, privateHeaders, requireUser } from "@/lib/guard";
import { ndaQueueAllowed } from "@/lib/nda";
import { loadNdaSnapshot } from "@/lib/ndaLoad";
import { loadNdaQueue } from "@/lib/ndaStore";

export async function GET() {
  const session = await requireUser();
  if (!isSession(session)) return session;
  if (!ndaQueueAllowed(session.actionRole)) {
    return NextResponse.json({ error: "You do not have permission for that." }, { status: 403, headers: privateHeaders });
  }
  console.info(JSON.stringify({ event: "data", user: session.u, part: "nda" }));
  const snapshot = loadNdaSnapshot();
  const queue = await loadNdaQueue(snapshot.register || []);
  return NextResponse.json({
    source: snapshot.source,
    as_of: snapshot.as_of,
    label: snapshot.label,
    queue,
  }, { headers: privateHeaders });
}
