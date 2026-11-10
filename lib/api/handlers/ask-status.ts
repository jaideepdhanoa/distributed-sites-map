import { askReady } from "@/lib/ask/model";
import { isSession, privateHeaders, requireUser } from "@/lib/guard";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await requireUser();
  if (!isSession(session)) return session;
  return NextResponse.json({ ready: askReady() }, { headers: privateHeaders });
}
