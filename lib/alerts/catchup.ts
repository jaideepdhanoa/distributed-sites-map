import type { Sql } from "@/lib/actions/db";
import { deliverRows } from "./deliver";
import { renderAlert, type RenderedMail } from "./template";
import { CATCHUP_EMAIL, CATCHUP_KEY, CATCHUP_SUBJECT, loadCatchUp, type SummaryCounts } from "./summary";

export type CatchUpStatus = "dry_run" | "sent" | "would_send" | "capped" | "error" | "skipped";

export type CatchUpResult = {
  dryRun: boolean;
  counts: SummaryCounts;
  status: CatchUpStatus;
};

export async function runCatchUp(sql: Sql, input: { dryRun: boolean; now?: Date }): Promise<CatchUpResult> {
  const now = input.now || new Date();
  const { items, counts } = await loadCatchUp(sql);
  if (input.dryRun) return { dryRun: true, counts, status: "dry_run" };
  const status = await deliverRows(sql, {
    userId: "jaideep",
    email: CATCHUP_EMAIL,
    rows: [],
    extra: items,
    key: CATCHUP_KEY,
    now,
    kind: "catchup",
    subject: CATCHUP_SUBJECT,
  });
  if (status === "sent" || status === "would_send" || status === "capped" || status === "error" || status === "skipped") {
    return { dryRun: false, counts, status };
  }
  return { dryRun: false, counts, status: "error" };
}

/** Dry-run output is counts only. A real run records a status and nothing from the message. */
export function printCatchUp(result: CatchUpResult): void {
  if (result.dryRun) {
    const counts = result.counts;
    console.log(
      [
        `recommendations: ${counts.recommendations}`,
        `decisions: ${counts.decisions}`,
        `proposals: ${counts.proposals}`,
        `stages: ${counts.stages}`,
        `activity: ${counts.activity}`,
        `comms: ${counts.comms}`,
        `sites: ${counts.sites}`,
        `asks: ${counts.asks}`,
        `conflicts: ${counts.conflicts}`,
        `threads: ${counts.threads}`,
      ].join("\n"),
    );
    return;
  }
  console.log(JSON.stringify({ ok: result.status === "sent", status: result.status }));
}

/** Preview is a local read. GitHub Actions never prints the message. */
export function catchUpPreviewAllowed(): boolean {
  return process.env.GITHUB_ACTIONS !== "true";
}

/**
 * Render the catch-up email. Does not write alert_log or alert_outbox and does not send.
 * The subject is the one-time catch-up subject.
 */
export async function previewCatchUp(sql: Sql, now = new Date()): Promise<RenderedMail | null> {
  const { items } = await loadCatchUp(sql);
  const rendered = renderAlert(items, { now, kind: "catchup", recipientId: "jaideep" });
  if (!rendered) return null;
  return { subject: CATCHUP_SUBJECT, body: rendered.body, html: rendered.html };
}
