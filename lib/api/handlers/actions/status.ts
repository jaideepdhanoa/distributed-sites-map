import { NextResponse } from "next/server";
import { isSession, privateHeaders, requireUser } from "@/lib/guard";
import { actionsEnabled } from "@/lib/actions/db";
import { snapshotStatus } from "@/lib/snapshot/read";

export async function GET() {
  const session = await requireUser();
  if (!isSession(session)) return session;
  return NextResponse.json(
    { enabled: actionsEnabled(), actionRole: session.actionRole, username: session.u, ...snapshotStatus() },
    { headers: privateHeaders },
  );
}
