import { NextResponse } from "next/server";
import { withSql } from "@/lib/actions/db";
import { migrate, whenReady } from "@/lib/actions/migrate";
import { authorizeJob } from "@/lib/alerts/job";
import { privateHeaders } from "@/lib/guard";
import { embedPending } from "@/lib/search/embed";

export async function GET(request: Request) {
  if (!(await authorizeJob(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
  }
  try {
    await whenReady(() => withSql(async (sql) => { await migrate(sql); }));
    const result = await withSql((sql) => embedPending(sql));
    return NextResponse.json({ ok: true, ...result }, { headers: privateHeaders });
  } catch {
    return NextResponse.json({ error: "The search embed could not run." }, { status: 500, headers: privateHeaders });
  }
}
