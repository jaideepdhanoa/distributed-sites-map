import { NextResponse } from "next/server";
import { authorizeJob } from "@/lib/alerts/job";
import { dispatchRepositoryWorkflow, type DispatchWorkflow } from "@/lib/cron/dispatch";
import { privateHeaders } from "@/lib/guard";
import { previewDatabaseWriteResponse, productionJobResponse } from "@/lib/preview/block";

export function cronGet(workflow: DispatchWorkflow) {
  return async function GET(request: Request): Promise<Response> {
    const blocked = previewDatabaseWriteResponse() || productionJobResponse();
    if (blocked) return blocked;
    if (!(await authorizeJob(request))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
    }
    const token = process.env.GITHUB_DISPATCH_TOKEN?.trim() || "";
    if (!token) {
      console.log(JSON.stringify({ event: "workflow_dispatch_unconfigured", workflow }));
      return NextResponse.json({ error: "GITHUB_DISPATCH_TOKEN is not set." }, { status: 500, headers: privateHeaders });
    }
    const result = await dispatchRepositoryWorkflow({ workflow, token });
    if (!result.ok) {
      const status = result.github_status == null ? 500 : 502;
      return NextResponse.json({ error: result.error }, { status, headers: privateHeaders });
    }
    return NextResponse.json(
      { ok: true, skipped: result.skipped, run_id: result.run_id },
      { headers: privateHeaders },
    );
  };
}
