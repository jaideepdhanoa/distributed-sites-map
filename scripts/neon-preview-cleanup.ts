import { appendFileSync } from "node:fs";
import { deleteClosedPreviewBranches } from "../lib/changes/cleanup";

function summary(text: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  appendFileSync(file, text.endsWith("\n") ? text : `${text}\n`);
}

async function main(): Promise<void> {
  const apiKey = process.env.NEON_API_KEY?.trim() || "";
  const projectId = process.env.NEON_PROJECT_ID?.trim() || "";
  if (!apiKey || !projectId) {
    const message = "NEON_API_KEY or NEON_PROJECT_ID is not set. Skipping preview branch cleanup.";
    console.log(message);
    summary(`## Neon preview branch cleanup skipped\n\n${message}\n\nSet the secret NEON_API_KEY and the variable NEON_PROJECT_ID. This job deletes branches named preview/<name> after a pull request closes. It never deletes the branch named preview, or a primary, default, or protected branch.\n`);
    return;
  }
  const deleted = await deleteClosedPreviewBranches({ apiKey, projectId });
  const line = deleted.length ? `Deleted ${deleted.join(", ")}.` : "No closed preview branches to delete.";
  console.log(line);
  summary(`## Neon preview branch cleanup\n\n${line}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "cleanup failed";
  console.error(message.slice(0, 300));
  summary(`## Neon preview branch cleanup failed\n\n${message.slice(0, 300)}\n`);
  process.exit(1);
});
