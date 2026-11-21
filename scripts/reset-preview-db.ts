import { appendFileSync } from "node:fs";
import { assertHostname, previewHostsMatchProduction, previewTargetValues } from "../lib/preview/env-values";
import { ensurePreviewBranch, resolveNeonProjectId } from "../lib/preview/neon";
import { redactSecrets } from "../lib/preview/redact";
import {
  applyPreviewEnv,
  latestPreviewDeployment,
  listProjectEnv,
  projectName,
  redeployPreview,
  vercelProjectId,
  vercelTeamId,
} from "../lib/preview/vercel";

function summary(text: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  appendFileSync(file, text.endsWith("\n") ? text : `${text}\n`);
}

const held: string[] = [];

function mask(value: string | undefined): void {
  const text = value?.trim() || "";
  if (text.length < 4) return;
  held.push(text);
  if (text.includes("\n")) return;
  process.stdout.write(`::add-mask::${text}\n`);
}

async function main(): Promise<void> {
  if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch") {
    console.error("Reset the preview database from the Reset preview database workflow.");
    process.exit(1);
  }
  if ((process.env.CONFIRM || "").trim() !== "reset-preview-db") {
    console.error("Refusing to reset the preview database. Type reset-preview-db in the confirmation field.");
    process.exit(1);
  }
  const apiKey = process.env.NEON_API_KEY?.trim() || "";
  const token = process.env.VERCEL_TOKEN?.trim() || "";
  mask(apiKey);
  mask(token);
  if (!apiKey) {
    console.error("NEON_API_KEY is not set.");
    process.exit(1);
  }
  if (!token) {
    console.error("VERCEL_TOKEN is not set.");
    process.exit(1);
  }
  let productionHost = "";
  try {
    productionHost = assertHostname(process.env.NEON_PRODUCTION_HOST || "");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "NEON_PRODUCTION_HOST must be a hostname.");
    process.exit(1);
  }
  const projectId = await resolveNeonProjectId(apiKey, process.env.NEON_PROJECT_ID || "");
  const preview = await ensurePreviewBranch({
    apiKey,
    projectId,
    onSecret: mask,
  });
  mask(preview.pooled);
  mask(preview.direct);
  if (previewHostsMatchProduction(preview.pooled, preview.direct, productionHost)) {
    console.error("Refusing to point Preview at the production database host. Vercel was not changed.");
    process.exit(1);
  }
  const values = previewTargetValues({
    pooled: preview.pooled,
    direct: preview.direct,
    productionHost,
  });
  for (const item of values.values()) mask(item.value);
  const vercel = {
    token,
    projectId: vercelProjectId(),
    teamId: vercelTeamId(),
    onSecret: mask,
  };
  const records = await listProjectEnv(vercel);
  const applied = await applyPreviewEnv(vercel, records, values);
  const narrowed = applied.narrowed.length ? applied.narrowed.join(", ") : "none";
  const wrote = applied.written.length ? applied.written.join(", ") : "none";
  const prepared = [
    `The Neon branch named preview was ${preview.action} from the production branch.`,
    `Narrowed shared env keys: ${narrowed}.`,
    `Wrote Preview env keys: ${wrote}.`,
    "Production and Development were not changed.",
  ].join(" ");
  console.log(prepared);
  summary(`## Preview database\n\n${prepared}\n`);
  const name = await projectName(vercel);
  const deployment = await latestPreviewDeployment(vercel);
  if (deployment) await redeployPreview(vercel, name, deployment);
  const redeployed = deployment ? "Redeployed the latest preview." : "No ready preview deployment. The Preview env applies on the next preview build.";
  console.log(redeployed);
  summary(`${redeployed}\n`);
}

main().catch((error: unknown) => {
  console.error(redactSecrets(error instanceof Error ? error.message : "Preview reset failed.", held));
  process.exit(1);
});
