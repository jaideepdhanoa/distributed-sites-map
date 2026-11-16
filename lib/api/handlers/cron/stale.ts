import { NextResponse } from "next/server";
import { withSql } from "@/lib/actions/db";
import { migrate, whenReady } from "@/lib/actions/migrate";
import { sweepStale } from "@/lib/agent/eventFeed";
import { authorizeJob } from "@/lib/alerts/job";
import { privateHeaders } from "@/lib/guard";

export async function GET(request: Request) {
  if (!(await authorizeJob(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
  }
  try {
    await whenReady(() => withSql(async (sql) => { await migrate(sql); }));
    const stale = await withSql((sql) => sweepStale(sql));
    return NextResponse.json({ ok: true, stale }, { headers: privateHeaders });
  } catch {
    return NextResponse.json({ error: "The stale sweep could not run." }, { status: 500, headers: privateHeaders });
  }
}
