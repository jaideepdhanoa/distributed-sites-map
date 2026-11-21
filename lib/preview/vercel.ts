import {
  keysForPreviewSplit,
  narrowBody,
  planPreviewEnv,
  previewWriteBody,
  recordsAfterNarrow,
  sharedPreviewStillAttached,
  type EnvPlan,
  type EnvRecord,
} from "./env-plan";
import type { PreviewValue } from "./env-values";
import { redactSecrets } from "./redact";

/** Already published in .github/workflows/validate-data.yml. Not a secret. */
export const PUBLIC_VERCEL_PROJECT_ID = "prj_EO8tpeZtslyXHrRLvq6IO8rai5bG";
export const PUBLIC_VERCEL_TEAM_ID = "team_y5zoRoQKTRtBgU8TapkYj9u1";

export function vercelProjectId(): string {
  return process.env.VERCEL_PROJECT_ID?.trim() || PUBLIC_VERCEL_PROJECT_ID;
}

export function vercelTeamId(): string {
  return process.env.VERCEL_TEAM_ID?.trim() || PUBLIC_VERCEL_TEAM_ID;
}

export type DeploymentRow = {
  uid: string;
  target?: string | null;
  readyState?: string;
};

export function isPreviewDeployment(deployment: { target?: string | null }): boolean {
  return deployment.target === "preview" || deployment.target == null;
}

export function selectPreviewDeployment(deployments: readonly DeploymentRow[]): DeploymentRow | null {
  return deployments.find((deployment) => deployment.uid && deployment.readyState === "READY" && isPreviewDeployment(deployment) && deployment.target !== "production") || null;
}

export function redeployBody(projectName: string, deploymentId: string): {
  name: string;
  deploymentId: string;
  target: "preview";
  meta: { action: "redeploy" };
} {
  const id = deploymentId.trim();
  if (!id || id === "production") throw new Error("Refusing to redeploy without a preview deployment id.");
  return {
    name: projectName,
    deploymentId: id,
    target: "preview",
    meta: { action: "redeploy" },
  };
}

type FetchImpl = typeof fetch;

export type VercelClientOptions = {
  token: string;
  projectId: string;
  teamId: string;
  fetchImpl?: FetchImpl;
  onSecret?: (value: string) => void;
};

function assertToken(token: string): string {
  const value = token.trim();
  if (!value) throw new Error("VERCEL_TOKEN is not set.");
  return value;
}

async function readJson(response: Response, secrets: readonly string[]): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Vercel request failed (${response.status}). ${redactSecrets(text, secrets)}`);
  }
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Vercel request failed (${response.status}).`);
  }
}

function teamQuery(teamId: string): string {
  return `teamId=${encodeURIComponent(teamId)}`;
}

export async function listProjectEnv(options: VercelClientOptions): Promise<EnvRecord[]> {
  const fetchImpl = options.fetchImpl || fetch;
  const token = assertToken(options.token);
  const response = await fetchImpl(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(options.projectId)}/env?${teamQuery(options.teamId)}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
  );
  const body = (await readJson(response, [token])) as { envs?: { id?: string; key?: string; target?: string[] }[] };
  const records: EnvRecord[] = [];
  for (const env of body.envs || []) {
    if (!env.id || !env.key) continue;
    records.push({ id: env.id, key: env.key, target: [...(env.target || [])] });
  }
  return records;
}

export type PreviewEnvApply = {
  narrowed: string[];
  written: string[];
};

export function planFromRecords(records: readonly EnvRecord[]): EnvPlan {
  return planPreviewEnv(records, keysForPreviewSplit(records));
}

export async function applyPreviewEnv(options: VercelClientOptions, records: readonly EnvRecord[], values: ReadonlyMap<string, PreviewValue>): Promise<PreviewEnvApply> {
  const fetchImpl = options.fetchImpl || fetch;
  const token = assertToken(options.token);
  const secrets = [token, ...[...values.values()].map((item) => item.value)];
  for (const value of secrets) options.onSecret?.(value);
  const plan = planFromRecords(records);
  const narrowed: string[] = [];
  const written: string[] = [];
  for (const step of plan.narrow) {
    if (!narrowed.includes(step.key)) narrowed.push(step.key);
    const response = await fetchImpl(
      `https://api.vercel.com/v9/projects/${encodeURIComponent(options.projectId)}/env/${encodeURIComponent(step.id)}?${teamQuery(options.teamId)}`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(narrowBody(step.target)),
      },
    );
    await readJson(response, secrets);
  }
  const after = plan.narrow.length ? await listProjectEnv(options) : recordsAfterNarrow(records, plan);
  for (const step of plan.write) {
    if (sharedPreviewStillAttached(after, step.key)) {
      throw new Error(`Refusing to set ${step.key} while a shared env var still includes Preview.`);
    }
    const value = values.get(step.key);
    if (!value) throw new Error(`No preview value for ${step.key}.`);
    const response = await fetchImpl(
      `https://api.vercel.com/v10/projects/${encodeURIComponent(options.projectId)}/env?${teamQuery(options.teamId)}&upsert=true`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(previewWriteBody(step.key, value.value, value.type)),
      },
    );
    await readJson(response, secrets);
    written.push(step.key);
  }
  const marker = written.indexOf("PREVIEW_DATABASE_BRANCH");
  if (marker >= 0) {
    if (!written.includes("DATABASE_URL") || written.indexOf("DATABASE_URL") > marker) {
      throw new Error("Refusing to set PREVIEW_DATABASE_BRANCH before DATABASE_URL.");
    }
    if (!written.includes("NEON_PRODUCTION_HOST") || written.indexOf("NEON_PRODUCTION_HOST") > marker) {
      throw new Error("Refusing to set PREVIEW_DATABASE_BRANCH before NEON_PRODUCTION_HOST.");
    }
  }
  return { narrowed, written };
}

export async function projectName(options: VercelClientOptions): Promise<string> {
  const fetchImpl = options.fetchImpl || fetch;
  const token = assertToken(options.token);
  const response = await fetchImpl(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(options.projectId)}?${teamQuery(options.teamId)}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
  );
  const body = (await readJson(response, [token])) as { name?: string };
  const name = body.name?.trim() || "";
  if (!name) throw new Error("Vercel did not return the project name.");
  return name;
}

/** v6/deployments rejects target=preview. Preview rows are filtered after the response. */
export function previewDeploymentsQuery(projectId: string, teamId: string): URL {
  const url = new URL("https://api.vercel.com/v6/deployments");
  url.searchParams.set("projectId", projectId);
  url.searchParams.set("teamId", teamId);
  url.searchParams.set("limit", "20");
  url.searchParams.set("state", "READY");
  return url;
}

export async function latestPreviewDeployment(options: VercelClientOptions): Promise<DeploymentRow | null> {
  const fetchImpl = options.fetchImpl || fetch;
  const token = assertToken(options.token);
  const url = previewDeploymentsQuery(options.projectId, options.teamId);
  if (url.searchParams.has("target")) throw new Error("Refusing to filter deployments with a target query.");
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  const body = (await readJson(response, [token])) as { deployments?: DeploymentRow[] };
  return selectPreviewDeployment(body.deployments || []);
}

export async function redeployPreview(options: VercelClientOptions, name: string, deployment: DeploymentRow): Promise<void> {
  if (!isPreviewDeployment(deployment) || deployment.target === "production") {
    throw new Error("Refusing to redeploy a deployment that is not a preview.");
  }
  const fetchImpl = options.fetchImpl || fetch;
  const token = assertToken(options.token);
  const body = redeployBody(name, deployment.uid);
  if (body.target !== "preview") throw new Error("Refusing to redeploy outside Preview.");
  const response = await fetchImpl(`https://api.vercel.com/v13/deployments?${teamQuery(options.teamId)}&forceNew=1`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  await readJson(response, [token]);
}
