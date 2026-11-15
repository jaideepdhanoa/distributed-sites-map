import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { withConnectionString } from "../lib/actions/db";
import { collectGenerated, generatedContentHash } from "../lib/snapshot/hash";
import { liveContentHash } from "../lib/snapshot/store";

function publicError(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : "snapshot compare failed";
  return text.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]").slice(0, 500);
}

function output(unchanged: boolean): void {
  const line = `unchanged=${unchanged ? "true" : "false"}\n`;
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, line);
  console.log(
    unchanged
      ? "Live snapshot hash matches. Skipping the database write and the cache refresh."
      : "Live snapshot hash differs.",
  );
}

async function main(): Promise<void> {
  const url = process.env.NEON_DATABASE_URL?.trim() || "";
  if (!url) {
    output(false);
    return;
  }
  const files = collectGenerated(join(process.cwd(), "data", "generated"));
  const local = generatedContentHash(files);
  const live = await withConnectionString(url, (sql) => liveContentHash(sql));
  output(live !== null && live === local);
}

main().catch((error: unknown) => {
  console.error(publicError(error));
  console.log("Could not read the live snapshot hash. The publish step will run.");
  output(false);
});
