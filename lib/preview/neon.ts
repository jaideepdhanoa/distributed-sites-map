import { redactSecrets } from "./redact";

export type NeonBranch = {
  id: string;
  name: string;
  primary?: boolean;
  default?: boolean;
  protected?: boolean;
  parent_id?: string;
};

export type BranchPlan =
  | { action: "create"; parentId: string }
  | { action: "restore"; branchId: string; parentId: string };

const PREVIEW_NAME = "preview";

function assertId(value: string, label: string): string {
  const id = value.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`${label} is not a single id.`);
  return id;
}

export function selectParentBranch(branches: readonly NeonBranch[]): NeonBranch {
  const eligible = branches.filter((branch) => branch.name !== PREVIEW_NAME && !branch.name.startsWith("preview/"));
  const parent =
    eligible.find((branch) => branch.default) ||
    eligible.find((branch) => branch.primary) ||
    eligible.find((branch) => branch.name === "main") ||
    eligible.find((branch) => branch.name === "production");
  if (!parent?.id) {
    throw new Error("Could not find the production Neon branch. Expected a default branch, or one named main or production.");
  }
  return parent;
}

/**
 * One long-lived branch named preview. Restore it from production when it
 * exists. Create it, with one read-write endpoint, when it does not.
 * Never keeps the previous copy under another name.
 */
export function planPreviewBranch(branches: readonly NeonBranch[]): BranchPlan {
  const parent = selectParentBranch(branches);
  const preview = branches.find((branch) => branch.name === PREVIEW_NAME);
  if (!preview) return { action: "create", parentId: parent.id };
  if (preview.primary || preview.default || preview.protected) {
    throw new Error("Refusing to reset a primary, default, or protected branch named preview.");
  }
  if (preview.id === parent.id) throw new Error("Refusing to reset the production branch.");
  return { action: "restore", branchId: preview.id, parentId: parent.id };
}

export function createPreviewBody(parentId: string): {
  branch: { name: "preview"; parent_id: string };
  endpoints: [{ type: "read_write" }];
} {
  return {
    branch: { name: "preview", parent_id: assertId(parentId, "Parent branch") },
    endpoints: [{ type: "read_write" }],
  };
}

export function restorePreviewBody(parentId: string): { source_branch_id: string } {
  return { source_branch_id: assertId(parentId, "Parent branch") };
}

export function createEndpointBody(branchId: string): { endpoint: { branch_id: string; type: "read_write" } } {
  return { endpoint: { branch_id: assertId(branchId, "Preview branch"), type: "read_write" } };
}

type FetchImpl = typeof fetch;

type Operation = { id?: string; status?: string };

export type NeonClientOptions = {
  apiKey: string;
  projectId: string;
  fetchImpl?: FetchImpl;
  sleep?: (ms: number) => Promise<void>;
  onSecret?: (value: string) => void;
};

function headers(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function readJson(response: Response, secrets: readonly string[]): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Neon request failed (${response.status}). ${redactSecrets(text, secrets)}`);
  }
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Neon request failed (${response.status}).`);
  }
}

function projectBase(projectId: string): string {
  return `https://console.neon.tech/api/v2/projects/${encodeURIComponent(assertId(projectId, "Neon project"))}`;
}

async function listBranches(options: NeonClientOptions): Promise<NeonBranch[]> {
  const fetchImpl = options.fetchImpl || fetch;
  const branches: NeonBranch[] = [];
  let cursor = "";
  for (let page = 0; page < 10; page += 1) {
    const url = `${projectBase(options.projectId)}/branches?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const response = await fetchImpl(url, { headers: headers(options.apiKey) });
    const body = (await readJson(response, [options.apiKey])) as {
      branches?: NeonBranch[];
      pagination?: { cursor?: string };
    };
    for (const branch of body.branches || []) {
      if (!branch?.id || !branch.name) continue;
      branches.push(branch);
    }
    const next = body.pagination?.cursor?.trim() || "";
    if (!next || next === cursor) break;
    cursor = next;
  }
  return branches;
}

async function waitOperations(options: NeonClientOptions, operations: readonly Operation[]): Promise<void> {
  const fetchImpl = options.fetchImpl || fetch;
  const sleep = options.sleep || ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (const operation of operations) {
    if (!operation.id) continue;
    let status = operation.status || "running";
    for (let attempt = 0; attempt < 40 && status !== "finished" && status !== "skipped"; attempt += 1) {
      if (status === "failed" || status === "cancelled") throw new Error("The Neon preview branch operation failed.");
      await sleep(3_000);
      const response = await fetchImpl(`${projectBase(options.projectId)}/operations/${encodeURIComponent(operation.id)}`, {
        headers: headers(options.apiKey),
      });
      const body = (await readJson(response, [options.apiKey])) as { operation?: Operation; status?: string };
      status = body.operation?.status || body.status || "running";
    }
    if (status !== "finished" && status !== "skipped") throw new Error("The Neon preview branch operation did not finish.");
  }
}

type Endpoint = { id?: string; branch_id?: string; type?: string };

async function listEndpoints(options: NeonClientOptions): Promise<Endpoint[]> {
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(`${projectBase(options.projectId)}/endpoints`, { headers: headers(options.apiKey) });
  const body = (await readJson(response, [options.apiKey])) as { endpoints?: Endpoint[] };
  return body.endpoints || [];
}

async function ensureEndpoint(options: NeonClientOptions, branchId: string): Promise<void> {
  const existing = await listEndpoints(options);
  if (existing.some((endpoint) => endpoint.branch_id === branchId && endpoint.type !== "read_only")) return;
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(`${projectBase(options.projectId)}/endpoints`, {
    method: "POST",
    headers: headers(options.apiKey),
    body: JSON.stringify(createEndpointBody(branchId)),
  });
  const body = (await readJson(response, [options.apiKey])) as { operations?: Operation[] };
  await waitOperations(options, body.operations || []);
}

async function databaseRole(options: NeonClientOptions, branchId: string): Promise<{ database: string; role: string }> {
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(`${projectBase(options.projectId)}/branches/${encodeURIComponent(branchId)}/databases`, {
    headers: headers(options.apiKey),
  });
  const body = (await readJson(response, [options.apiKey])) as {
    databases?: { name?: string; owner_name?: string }[];
  };
  const databases = body.databases || [];
  const database = databases.find((item) => item.name === "neondb") || databases[0];
  if (!database?.name || !database.owner_name) throw new Error("The preview branch has no database role.");
  return { database: database.name, role: database.owner_name };
}

async function connectionUri(options: NeonClientOptions, branchId: string, database: string, role: string, pooled: boolean): Promise<string> {
  const fetchImpl = options.fetchImpl || fetch;
  const url = new URL(`${projectBase(options.projectId)}/connection_uri`);
  url.searchParams.set("branch_id", branchId);
  url.searchParams.set("database_name", database);
  url.searchParams.set("role_name", role);
  url.searchParams.set("pooled", pooled ? "true" : "false");
  const response = await fetchImpl(url, { headers: headers(options.apiKey) });
  const body = (await readJson(response, [options.apiKey])) as { uri?: string };
  const uri = body.uri?.trim() || "";
  if (!uri) throw new Error("Neon did not return a preview connection string.");
  options.onSecret?.(uri);
  return uri;
}

export async function resolveNeonProjectId(apiKey: string, explicit: string, fetchImpl: FetchImpl = fetch): Promise<string> {
  const given = explicit.trim();
  if (given) return assertId(given, "Neon project");
  const response = await fetchImpl("https://console.neon.tech/api/v2/projects", {
    headers: headers(apiKey),
  });
  const body = (await readJson(response, [apiKey])) as { projects?: { id?: string }[] };
  const projects = (body.projects || []).map((project) => project.id?.trim() || "").filter(Boolean);
  if (projects.length === 1) return assertId(projects[0], "Neon project");
  throw new Error(
    "NEON_PROJECT_ID is not set, and the API key can see more than one Neon project. Set the repository variable NEON_PROJECT_ID.",
  );
}

export type PreviewBranchResult = {
  action: "created" | "restored";
  branchId: string;
  pooled: string;
  direct: string;
};

/**
 * Create or reset the single branch named preview from the production branch.
 * Does not create a backup branch and does not delete any other branch.
 */
export async function ensurePreviewBranch(options: NeonClientOptions): Promise<PreviewBranchResult> {
  const branches = await listBranches(options);
  const plan = planPreviewBranch(branches);
  const fetchImpl = options.fetchImpl || fetch;
  let branchId = "";
  let action: "created" | "restored";
  if (plan.action === "create") {
    const response = await fetchImpl(`${projectBase(options.projectId)}/branches`, {
      method: "POST",
      headers: headers(options.apiKey),
      body: JSON.stringify(createPreviewBody(plan.parentId)),
    });
    const body = (await readJson(response, [options.apiKey])) as {
      branch?: { id?: string };
      operations?: Operation[];
    };
    branchId = body.branch?.id || "";
    if (!branchId) throw new Error("Neon did not return the preview branch.");
    await waitOperations(options, body.operations || []);
    action = "created";
  } else {
    branchId = plan.branchId;
    const response = await fetchImpl(`${projectBase(options.projectId)}/branches/${encodeURIComponent(branchId)}/restore`, {
      method: "POST",
      headers: headers(options.apiKey),
      body: JSON.stringify(restorePreviewBody(plan.parentId)),
    });
    const body = (await readJson(response, [options.apiKey])) as { operations?: Operation[] };
    await waitOperations(options, body.operations || []);
    action = "restored";
    // Create already asked for one endpoint. A second endpoint would spend another free-plan compute.
    await ensureEndpoint(options, branchId);
  }
  const names = await databaseRole(options, branchId);
  const pooled = await connectionUri(options, branchId, names.database, names.role, true);
  const direct = await connectionUri(options, branchId, names.database, names.role, false);
  return { action, branchId, pooled, direct };
}

/** Read the existing preview branch. Does not create or reset it. */
export async function readPreviewBranch(options: NeonClientOptions): Promise<{ branchId: string; pooled: string; direct: string }> {
  const branches = await listBranches(options);
  const preview = branches.find((branch) => branch.name === PREVIEW_NAME);
  if (!preview?.id) {
    throw new Error("The Neon branch named preview does not exist. Run Reset preview database and type reset-preview-db.");
  }
  if (preview.primary || preview.default || preview.protected) {
    throw new Error("Refusing to migrate a primary, default, or protected branch named preview.");
  }
  const parent = selectParentBranch(branches);
  if (preview.id === parent.id) throw new Error("Refusing to migrate the production branch.");
  const names = await databaseRole(options, preview.id);
  const pooled = await connectionUri(options, preview.id, names.database, names.role, true);
  const direct = await connectionUri(options, preview.id, names.database, names.role, false);
  return { branchId: preview.id, pooled, direct };
}
