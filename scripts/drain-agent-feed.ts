import { withConnectionString } from "../lib/actions/db";
import { assertFeedDrainApply, formatFeedDrain, runFeedDrain } from "../lib/agent/feedDrain";

/**
 * Project events into the agent feed and put the 2026-11-16 flood rows back
 * on their event times.
 *
 * Dry run is the default and writes nothing. It prints counts only.
 *
 *   npx tsx scripts/drain-agent-feed.ts
 *
 * Apply needs the confirm phrase. It refuses to run without it.
 *
 *   CONFIRM=drain-agent-feed npx tsx scripts/drain-agent-feed.ts --apply
 *
 * A production write also needs ALLOW_DRAIN_AGENT_FEED=1, and only after the
 * dry-run counts have been read. Previews and pull-request jobs cannot write.
 * Do not run an apply against production from this pull request.
 */

function redact(error: unknown): string {
  const text = error instanceof Error ? error.message : "agent feed drain failed";
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]")
    .replace(/\b[\w.-]+\.neon\.tech\b/gi, "[redacted-host]")
    .slice(0, 500);
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const url = process.env.NEON_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || "";
  if (!url) throw new Error("NEON_DATABASE_URL is not set.");
  if (apply) assertFeedDrainApply(url, process.env.CONFIRM);
  const result = await withConnectionString(url, (sql) =>
    runFeedDrain(sql, { apply, confirm: process.env.CONFIRM }),
  );
  console.log(formatFeedDrain(result));
  console.log(apply
    ? `Reset ${result.timestampsReset} timestamps. Projected ${result.projected} feed rows.`
    : "Dry run. Nothing was written.");
}

main().catch((error: unknown) => {
  console.error(redact(error));
  process.exit(1);
});
