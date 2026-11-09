import { NextResponse } from "next/server";
import { withSql } from "@/lib/actions/db";
import { migrate, whenReady } from "@/lib/actions/migrate";
import { sendDigests } from "@/lib/alerts/deliver";
import { authorizeJob } from "@/lib/alerts/job";
import { privateHeaders } from "@/lib/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await authorizeJob(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
  }
  try {
    await whenReady(() => withSql(async (sql) => { await migrate(sql); }));
    const sent = await withSql((sql) => sendDigests(sql));
    return NextResponse.json({ ok: true, sent }, { headers: privateHeaders });
  } catch {
    return NextResponse.json({ error: "The digest could not run." }, { status: 500, headers: privateHeaders });
  }
}
