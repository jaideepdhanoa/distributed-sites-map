import { NextResponse } from "next/server";
import { withSql } from "@/lib/actions/db";
import { migrate, whenReady } from "@/lib/actions/migrate";
import { flushInstant } from "@/lib/alerts/deliver";
import { authorizeJob } from "@/lib/alerts/job";
import { privateHeaders } from "@/lib/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function runFlush(request: Request) {
  if (!(await authorizeJob(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
  }
  try {
    await whenReady(() => withSql(async (sql) => { await migrate(sql); }));
    const sent = await withSql((sql) => flushInstant(sql));
    return NextResponse.json({ ok: true, sent }, { headers: privateHeaders });
  } catch {
    return NextResponse.json({ error: "The alert flush could not run." }, { status: 500, headers: privateHeaders });
  }
}

export function GET(request: Request) {
  return runFlush(request);
}

export function POST(request: Request) {
  return runFlush(request);
}
