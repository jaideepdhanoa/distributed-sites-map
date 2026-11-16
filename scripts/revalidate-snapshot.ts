import { appendFileSync } from "node:fs";
import { productionRevalidateUrl } from "../lib/snapshot/auth";

function summary(text: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  appendFileSync(file, text.endsWith("\n") ? text : `${text}\n`);
}

async function main(): Promise<void> {
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
    console.error("Refusing to refresh the production cache from a Vercel preview.");
    process.exit(1);
  }
  const secret = process.env.CRON_SECRET?.trim() || "";
  if (!secret) {
    const message = "CRON_SECRET is not set. Skipping cache refresh. The site picks up the snapshot within about 5 minutes.";
    console.log(message);
    summary(`## Cache refresh skipped\n\n${message}\n`);
    return;
  }
  const url = productionRevalidateUrl(process.env.SNAPSHOT_REVALIDATE_URL);
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!response.ok) {
    console.error(`Cache refresh failed (${response.status}).`);
    summary(`## Cache refresh failed\n\nThe production site returned ${response.status}. The snapshot is already live. Pages pick it up within about 5 minutes.\n`);
    process.exit(1);
  }
  console.log("Site cache refreshed.");
  summary("## Cache refreshed\n\nThe production site reads the new snapshot on the next request.\n");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Cache refresh failed.");
  process.exit(1);
});
