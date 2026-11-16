import { actionsEnabled, getPool, withSql } from "../lib/actions/db";
import { catchUpPreviewAllowed, previewCatchUp, printCatchUp, runCatchUp } from "../lib/alerts/catchup";

// One catch-up email for jaideep@dhanoa.in. Dry run is the default.
// A dry run prints counts only. A real run (DRY_RUN=false) sends once.
// PREVIEW=true (or --preview) prints the rendered email locally and does not send.
// Preview is refused in GitHub Actions so the message never lands in a job log.

function sendRequested(): boolean {
  return process.env.DRY_RUN === "false";
}

function previewRequested(): boolean {
  return process.env.PREVIEW === "true" || process.argv.includes("--preview");
}

async function main() {
  const preview = previewRequested();
  if (process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_REF && process.env.GITHUB_REF !== "refs/heads/main") {
    console.error("Catch-up runs only on main.");
    process.exit(1);
  }
  if (preview && !catchUpPreviewAllowed()) {
    console.error("Preview runs only outside CI.");
    process.exit(1);
  }
  if (!actionsEnabled()) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  if (preview) {
    const mail = await withSql((sql) => previewCatchUp(sql));
    await getPool().end();
    if (!mail) {
      console.log("Nothing to preview.");
      return;
    }
    console.log(`Subject: ${mail.subject}`);
    console.log("");
    console.log(mail.body);
    console.log("");
    console.log(mail.html);
    return;
  }
  const dryRun = !sendRequested();
  const result = await withSql((sql) => runCatchUp(sql, { dryRun }));
  printCatchUp(result);
  await getPool().end();
  if (!dryRun && result.status !== "sent") process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.name : "catch-up failed");
  process.exit(1);
});
