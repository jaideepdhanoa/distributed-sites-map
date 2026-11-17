import { NextResponse } from "next/server";
import { canReadFinancials } from "@/lib/agent/access";
import { actionsEnabled, withSql, type Sql } from "@/lib/actions/db";
import { canSeeGmailLinks } from "@/lib/comms";
import { isSession, privateHeaders, requireUser } from "@/lib/guard";
import { loadFinancialPanel } from "@/lib/financialsLoad";
import { attachPnlSourceLinks } from "@/lib/pnl/attachSources";
import { demoStatement } from "@/lib/pnl/demo";
import type { OpenPnlComment } from "@/lib/comments/anchor";
import { loadOpenPnlComments } from "@/lib/comments/record";
import { serviceDriveLister } from "@/lib/pnl/driveFiles";
import { siteFolderId } from "@/lib/pnl/sourceLink";
import { loadConflicts } from "@/lib/conflicts/record";
import type { DataConflict } from "@/lib/conflicts/view";
import { linkedPnlIds, loadPnlStatement } from "@/lib/pnl/read";
import { emptyStatement, unavailableStatement, type PnlStatement } from "@/lib/pnl/statement";
import { loadWorkbookStep } from "@/lib/workbookStepLoad";
import { fileLookup, recordLinks } from "@/lib/actions/records";
import type { DealProps } from "@/lib/types";

/** This response is computed per request. A cached copy must not stand in for it. */
export function financialsHeaders(): Record<string, string> {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.trim() || "";
  return {
    ...privateHeaders,
    "Cache-Control": "private, no-store, max-age=0, must-revalidate",
    "CDN-Cache-Control": "no-store",
    "Vercel-CDN-Cache-Control": "no-store",
    ...(sha ? { "x-build-sha": sha } : {}),
  };
}

/** The pnl object GET /api/data/financials/:id returns after the session check. */
export async function loadFinancialsPayload(
  sql: Sql,
  id: string,
  links: { dealId: string; siteId: string }[],
): Promise<{ pnl: PnlStatement; conflicts: DataConflict[]; comments: OpenPnlComment[]; pnlDemo: boolean }> {
  const ids = linkedPnlIds(id, links);
  const [pnlResult, conflictResult, commentResult] = await Promise.all([
    loadPnlStatement(sql, ids).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
    loadConflicts(sql, ids).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
    loadOpenPnlComments(sql, ids).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
  ]);
  let pnl = pnlResult.ok ? pnlResult.value : unavailableStatement();
  const conflicts = conflictResult.ok ? conflictResult.value : [];
  const comments = commentResult.ok ? commentResult.value : [];
  const demo = pnl.status === "ready" ? null : ids.reduce<ReturnType<typeof demoStatement>>((found, item) => found || demoStatement(item), null);
  if (demo) pnl = demo;
  return { pnl, conflicts, comments, pnlDemo: Boolean(demo) };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireUser();
  if (!isSession(session)) return session;
  if (!canReadFinancials(session.actionRole)) {
    return NextResponse.json({ error: "You do not have permission for that." }, { status: 403, headers: privateHeaders });
  }
  const { id } = await context.params;
  const links = await recordLinks();
  const ids = linkedPnlIds(id, links);
  const deal = (await fileLookup())("deal", ids.find((item) => item.startsWith("PIPE-") || item.startsWith("LAND-")) || id) as DealProps | null;
  if (!deal) return NextResponse.json({ error: "Not found" }, { status: 404, headers: financialsHeaders() });
  const panel = loadFinancialPanel(deal, true);
  const workbookStep = loadWorkbookStep(deal.deal_id);
  const loaded = actionsEnabled()
    ? await withSql((sql) => loadFinancialsPayload(sql, id, links)).catch((error: unknown) => {
      console.error(JSON.stringify({ event: "pnl_read_error", name: error instanceof Error ? error.name : "error" }));
      return { pnl: unavailableStatement(), conflicts: [] as DataConflict[], comments: [] as OpenPnlComment[], pnlDemo: false };
    })
    : { pnl: emptyStatement(), conflicts: [] as DataConflict[], comments: [] as OpenPnlComment[], pnlDemo: false };
  let pnl = loaded.pnl;
  try {
    const lister = loaded.pnlDemo ? null : await serviceDriveLister();
    pnl = await attachPnlSourceLinks(pnl, {
      folderId: siteFolderId(deal.folder_url),
      gmailAllowed: canSeeGmailLinks(session.u),
      lister,
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "pnl_source_link", name: error instanceof Error ? error.name : "error" }));
  }
  console.info(JSON.stringify({ event: "data", user: session.u, part: "financials", id }));
  return NextResponse.json({ ...panel, workbookStep, ...loaded, pnl }, { headers: financialsHeaders() });
}
