import { isResponse, jsonOk, openActions, runWrite } from "@/lib/actions/http";
import { EXCLUDED_SITE_ID } from "@/lib/alerts/excluded";
import { gapReference } from "@/lib/actions/gapReference";
import { safeSnapshot } from "@/lib/policy/banned";

type Gap = { id: string; target_id: string; target_kind: string; body: string };
type Step = { id: string; target_id: string; target_kind: string; title: string; owner: string; due: string; status: string; reason: string };
export type WorkRow = { id: string; site: string; note?: string; title: string; owner: string; due: string; status: string; kind: "Action" | "Evidence gap" | "NDA" };

export async function GET() {
  const session = await openActions("viewer");
  if (isResponse(session)) return session;
  const payload = await runWrite(session, { action: "work.list" }, async sql => {
    const gaps = await sql.query<Gap>(`SELECT id, target_id, target_kind, body FROM notes WHERE target_kind IN ('site','deal')
      AND parent_id IS NULL AND resolved_at IS NULL AND deleted_at IS NULL AND target_id <> $1
      AND body LIKE $2 ORDER BY created_at DESC`, [EXCLUDED_SITE_ID, "Missing evidence\n%\nCheck: %"]);
    const steps = await sql.query<Step>(`SELECT id, target_id, target_kind, coalesce(nullif(title,''), proposed_value) AS title, coalesce(owner_id,'') AS owner,
      coalesce(target_on::text,'') AS due, status, reason FROM suggestions
      WHERE field_name = 'proposed_next_step' AND done_at IS NULL AND target_id <> $1
      AND status IN ('open','accepted','agreed_waiting','ready') ORDER BY target_on NULLS LAST, created_at`, [EXCLUDED_SITE_ID]);
    const rows: WorkRow[] = [];
    const openGaps = new Map(gaps.rows.map(gap => [gap.target_kind + gapReference(gap.target_id, gap.id), gap]));
    const linked = new Set<string>();
    for (const step of steps.rows) {
      const gap = openGaps.get(step.target_kind + step.reason);
      if (gap) linked.add(gap.id);
      if (!gap && step.owner !== session.u) continue;
      const title = safeSnapshot(step.title, 500);
      if (title) rows.push({ id:step.id, site:step.target_id, title, owner:step.owner, due:step.due, status:step.status, kind:gap ? "Evidence gap" : "Action", note:gap?.id });
    }
    for (const gap of gaps.rows) {
      if (linked.has(gap.id)) continue;
      const title = safeSnapshot(gap.body.slice("Missing evidence\n".length,gap.body.lastIndexOf("\nCheck: ")), 500);
      if (title) rows.push({id:gap.id, site:gap.target_id, title, owner:"", due:"", status:"Unresolved", kind:"Evidence gap", note:gap.id});
    }
    return { rows };
  });
  return isResponse(payload) ? payload : jsonOk(payload);
}
