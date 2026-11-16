/**
 * Start a GitHub Actions workflow from Vercel Cron.
 *
 * The token is GITHUB_DISPATCH_TOKEN, a fine-grained personal access token
 * with Actions read and write on this repository only. It is sent as a
 * Bearer header and never written to a log, a response, or a URL.
 * A log line is a run id. Request bodies and workbook data stay out.
 */

export const DISPATCH_REPOSITORY = "jaideepdhanoa/distributed-sites-map";
export const DISPATCH_REF = "main";

export const CRON_JOBS = [
  { workflow: "workbook-sync.yml", path: "/api/cron/workbook-sync", schedule: "*/15 * * * *" },
  { workflow: "alert-flush.yml", path: "/api/cron/alert-flush", schedule: "*/5 * * * *" },
] as const;

export type DispatchWorkflow = (typeof CRON_JOBS)[number]["workflow"];

/** A run in one of these states already owns the workflow. Do not start another. */
export const ACTIVE_WORKFLOW_STATUSES = ["queued", "in_progress", "requested", "pending", "waiting"] as const;

const ACTIVE = new Set<string>(ACTIVE_WORKFLOW_STATUSES);

export type DispatchResult =
  | { ok: true; skipped: boolean; run_id: number | null }
  | { ok: false; error: string; github_status: number | null };

type WorkflowRun = { id: number; status: string };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const POLLS = 4;

function repositoryParts(repository: string): { owner: string; repo: string } | null {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(repository.trim());
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

function isWorkflow(workflow: string): workflow is DispatchWorkflow {
  return CRON_JOBS.some((job) => job.workflow === workflow);
}

function writeLog(log: (line: string) => void, token: string, payload: Record<string, string | number | boolean>): void {
  const line = JSON.stringify(payload);
  if (token && line.includes(token)) return;
  log(line);
}

function activeRun(runs: WorkflowRun[]): WorkflowRun | null {
  let found: WorkflowRun | null = null;
  for (const run of runs) {
    if (!ACTIVE.has(run.status)) continue;
    if (!found || run.id > found.id) found = run;
  }
  return found;
}

function createdRunId(before: WorkflowRun[], after: WorkflowRun[]): number | null {
  const floor = before.reduce((max, run) => Math.max(max, run.id), 0);
  let created: number | null = null;
  for (const run of after) {
    if (run.id <= floor) continue;
    if (created == null || run.id > created) created = run.id;
  }
  return created;
}

function runsFromBody(body: unknown): WorkflowRun[] | null {
  if (!body || typeof body !== "object" || !Array.isArray((body as { workflow_runs?: unknown }).workflow_runs)) return null;
  const out: WorkflowRun[] = [];
  for (const row of (body as { workflow_runs: unknown[] }).workflow_runs) {
    if (!row || typeof row !== "object") continue;
    const id = (row as { id?: unknown }).id;
    const status = (row as { status?: unknown }).status;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0 || typeof status !== "string") continue;
    out.push({ id, status });
  }
  return out;
}

async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

function githubHeaders(token: string, json: boolean): Headers {
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  headers.set("User-Agent", "distributed-sites-map-cron");
  if (json) headers.set("Content-Type", "application/json");
  return headers;
}

export async function dispatchRepositoryWorkflow(options: {
  workflow: string;
  token: string;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}): Promise<DispatchResult> {
  const token = options.token.trim();
  const workflow = options.workflow;
  const log = options.log || ((line) => console.log(line));
  if (!token) return { ok: false, error: "GITHUB_DISPATCH_TOKEN is not set.", github_status: null };
  if (!isWorkflow(workflow)) return { ok: false, error: "The workflow could not be dispatched.", github_status: null };
  const parts = repositoryParts(DISPATCH_REPOSITORY);
  if (!parts) return { ok: false, error: "The workflow could not be dispatched.", github_status: null };
  const fetchImpl = options.fetchImpl || fetch;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const base = `https://api.github.com/repos/${encodeURIComponent(parts.owner)}/${encodeURIComponent(parts.repo)}/actions/workflows/${encodeURIComponent(workflow)}`;

  async function listRuns(): Promise<{ ok: true; runs: WorkflowRun[] } | { ok: false; status: number }> {
    let response: Response;
    try {
      response = await fetchImpl(`${base}/runs?per_page=30`, {
        method: "GET",
        headers: githubHeaders(token, false),
        cache: "no-store",
        redirect: "manual",
      });
    } catch {
      return { ok: false, status: 0 };
    }
    if (response.status < 200 || response.status >= 300) {
      await discard(response);
      return { ok: false, status: response.status };
    }
    try {
      const runs = runsFromBody(await response.json());
      if (!runs) return { ok: false, status: response.status };
      return { ok: true, runs };
    } catch {
      return { ok: false, status: response.status };
    }
  }

  const before = await listRuns();
  if (!before.ok) {
    writeLog(log, token, { event: "workflow_dispatch_failed", workflow, github_status: before.status });
    return { ok: false, error: "The workflow could not be dispatched.", github_status: before.status || null };
  }
  const busy = activeRun(before.runs);
  if (busy) {
    writeLog(log, token, { event: "workflow_dispatch_skipped", workflow, run_id: busy.id });
    return { ok: true, skipped: true, run_id: busy.id };
  }

  let posted: Response;
  try {
    posted = await fetchImpl(`${base}/dispatches`, {
      method: "POST",
      headers: githubHeaders(token, true),
      body: JSON.stringify({ ref: DISPATCH_REF }),
      cache: "no-store",
      redirect: "manual",
    });
  } catch {
    writeLog(log, token, { event: "workflow_dispatch_failed", workflow, github_status: 0 });
    return { ok: false, error: "The workflow could not be dispatched.", github_status: null };
  }
  if (posted.status !== 204) {
    const status = posted.status;
    await discard(posted);
    writeLog(log, token, { event: "workflow_dispatch_failed", workflow, github_status: status });
    return { ok: false, error: "The workflow could not be dispatched.", github_status: status };
  }
  await discard(posted);

  let runId: number | null = null;
  for (let attempt = 0; attempt < POLLS; attempt += 1) {
    if (attempt > 0) await sleep(300 * attempt);
    const after = await listRuns();
    if (!after.ok) continue;
    runId = createdRunId(before.runs, after.runs);
    if (runId != null) break;
  }
  if (runId != null) writeLog(log, token, { event: "workflow_dispatch", workflow, run_id: runId });
  return { ok: true, skipped: false, run_id: runId };
}
