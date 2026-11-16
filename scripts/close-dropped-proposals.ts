import { withConnectionString } from "../lib/actions/db";
import { assertCloseDroppedApply, formatClosePlan, runCloseDroppedProposals } from "../lib/actions/proposalClose";

/**
 * Close open proposals that still sit on Dropped sites.
 *
 * Dry run is the default and writes nothing. It prints proposal ids and site ids only.
 *
 *   npx tsx scripts/close-dropped-proposals.ts
 *
 * Apply needs the confirm phrase. It refuses to run without it.
 *
 *   CONFIRM=close-dropped-proposals npx tsx scripts/close-dropped-proposals.ts --apply
 *
 * A production write also needs ALLOW_CLOSE_DROPPED_PROPOSALS=1, and only after
 * the dry-run list has been read. Previews and pull-request jobs cannot write.
 * Do not run an apply against production from this pull request.
 */

function redact(error: unknown): string {
  const text = error instanceof Error ? error.message : "close dropped proposals failed";
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]")
    .replace(/\b[\w.-]+\.neon\.tech\b/gi, "[redacted-host]")
    .slice(0, 500);
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const url = process.env.NEON_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || "";
  if (!url) throw new Error("NEON_DATABASE_URL is not set.");
  if (apply) assertCloseDroppedApply(url, process.env.CONFIRM);
  const result = await withConnectionString(url, (sql) =>
    runCloseDroppedProposals(sql, { apply, confirm: process.env.CONFIRM }),
  );
  console.log(formatClosePlan(result.proposals, result.mode));
  console.log(apply ? `Closed ${result.closed} proposals.` : "Dry run. Nothing was written.");
}

main().catch((error: unknown) => {
  console.error(redact(error));
  process.exit(1);
});
