import { appendFileSync } from "node:fs";
import { runPreviewCleanup } from "../lib/changes/cleanup";

function summary(text: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  appendFileSync(file, text.endsWith("\n") ? text : `${text}\n`);
}

function redact(text: string): string {
  let out = text;
  for (const secret of [process.env.NEON_API_KEY, process.env.GITHUB_TOKEN]) {
    const value = secret?.trim();
    if (!value || value.length < 8) continue;
    out = out.split(value).join("[redacted]");
  }
  return out;
}

async function main(): Promise<void> {
  const apiKey = process.env.NEON_API_KEY?.trim() || "";
  const projectId = process.env.NEON_PROJECT_ID?.trim() || "";
  if (!apiKey || !projectId) {
    const message = "NEON_API_KEY or NEON_PROJECT_ID is not set. Skipping preview branch cleanup.";
    console.log(message);
    summary(`## Neon preview branch cleanup skipped\n\n${message}\n\nSet the secret NEON_API_KEY and the variable NEON_PROJECT_ID. When a pull request closes, this job deletes only the branch named preview/<head ref>. It never deletes the shared preview branch, or a primary, default, protected, or production branch. An empty head ref deletes nothing.\n`);
    return;
  }
  const report = await runPreviewCleanup({
    apiKey,
    projectId,
    eventName: process.env.GITHUB_EVENT_NAME || "",
    headRef: process.env.PR_HEAD_REF || "",
    dryRun: (process.env.CLEANUP_DRY_RUN || "1") !== "0",
    repository: process.env.GITHUB_REPOSITORY || "",
    token: process.env.GITHUB_TOKEN || "",
  });
  const message = redact(report.message);
  console.log(message);
  summary(`## Neon preview branch cleanup\n\n${message}\n`);
}

main().catch((error: unknown) => {
  const message = redact(error instanceof Error ? error.message : "cleanup failed").slice(0, 300);
  console.error(message);
  summary(`## Neon preview branch cleanup failed\n\n${message}\n`);
  process.exit(1);
});
