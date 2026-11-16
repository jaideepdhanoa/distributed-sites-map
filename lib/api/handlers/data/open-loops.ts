import { NextResponse } from "next/server";
import { actionsEnabled, withSql } from "@/lib/actions/db";
import { conflictLoops } from "@/lib/conflicts/loops";
import { isSession, privateHeaders, requireUser } from "@/lib/guard";
import { ndaQueueAllowed } from "@/lib/nda";
import { openLoopsBody } from "@/lib/openLoops";
import { loadOpenLoops } from "@/lib/openLoopsLoad";
import { redactGmailPayload } from "@/lib/displayText";

export async function GET() {
  const session = await requireUser();
  if (!isSession(session)) return session;
  if (!ndaQueueAllowed(session.actionRole)) {
    return NextResponse.json({ error: "You do not have permission for that." }, { status: 403, headers: privateHeaders });
  }
  const body = openLoopsBody(loadOpenLoops());
  if (actionsEnabled()) {
    try {
      const extra = await withSql((sql) => conflictLoops(sql));
      body.loops = [...body.loops, ...extra];
    } catch (error) {
      console.error(JSON.stringify({ event: "conflict_read_error", name: error instanceof Error ? error.name : "error" }));
    }
  }
  console.info(JSON.stringify({ event: "data", user: session.u, part: "open-loops" }));
  return NextResponse.json(redactGmailPayload(body), { headers: privateHeaders });
}
