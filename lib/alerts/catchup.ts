import type { Sql } from "@/lib/actions/db";
import { deliverRows } from "./deliver";
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
        `stages: ${counts.stages}`,
        `activity: ${counts.activity}`,
        `comms: ${counts.comms}`,
        `sites: ${counts.sites}`,
        `asks: ${counts.asks}`,
      ].join("\n"),
    );
    return;
  }
  console.log(JSON.stringify({ ok: result.status === "sent", status: result.status }));
}
