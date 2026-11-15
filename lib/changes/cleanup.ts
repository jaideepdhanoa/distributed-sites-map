export type NeonBranch = {
  id?: string;
  name?: string;
  primary?: boolean;
  default?: boolean;
  protected?: boolean;
};

const BLOCKED = new Set(["preview", "main", "production", "primary", "master"]);

type BranchPage = { branches?: NeonBranch[]; pagination?: { cursor?: string } };

export type CleanupReport = {
  deleted: string[];
  listed: string[];
  message: string;
};

type FetchOptions = {
  apiKey: string;
  projectId: string;
  fetchImpl?: typeof fetch;
};

/** A pull request head ref, or "" when the cleanup must delete nothing. */
export function headRefFromEvent(headRef: string | undefined | null): string {
  if (typeof headRef !== "string") return "";
  const ref = headRef.trim();
  if (!ref || ref.length > 250) return "";
  // Branch names in this repo look like cursor/fix-alert-delivery-9b01.
  // Anything else is not a preview target: empty, glob, or shell metacharacters delete nothing.
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref)) return "";
  if (ref.includes("..") || ref.includes("//") || ref.endsWith("/") || ref.endsWith(".lock")) return "";
  return ref;
}

/**
 * True only for the branch named exactly preview/<headRef>.
 * Primary, default, protected, and production branches stay.
 */
export function previewBranchDeletable(branch: NeonBranch, headRef: string): boolean {
  if (branch.primary || branch.default || branch.protected) return false;
  const name = String(branch.name || "").trim();
  if (!name || BLOCKED.has(name.toLowerCase())) return false;
  const ref = headRefFromEvent(headRef);
  if (!ref) return false;
  return name === `preview/${ref}`;
}

function refFromPreviewName(name: string | undefined): string {
  const trimmed = String(name || "").trim();
  const prefix = "preview/";
  if (!trimmed.startsWith(prefix)) return "";
  const ref = headRefFromEvent(trimmed.slice(prefix.length));
  if (!ref || trimmed !== `preview/${ref}`) return "";
  return ref;
}

function neonBase(projectId: string): string {
  return `https://console.neon.tech/api/v2/projects/${encodeURIComponent(projectId)}/branches`;
}

function neonHeaders(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
}

async function listBranches(options: FetchOptions): Promise<NeonBranch[]> {
  const fetchImpl = options.fetchImpl || fetch;
  const headers = neonHeaders(options.apiKey);
  const base = neonBase(options.projectId);
  const branches: NeonBranch[] = [];
  let cursor = "";
  for (let page = 0; page < 10; page += 1) {
    const url = cursor ? `${base}?limit=100&cursor=${encodeURIComponent(cursor)}` : `${base}?limit=100`;
    const response = await fetchImpl(url, { headers });
    if (!response.ok) throw new Error(`Neon branch list failed (${response.status}).`);
    const body = (await response.json()) as BranchPage;
    branches.push(...(body.branches || []));
    const next = body.pagination?.cursor?.trim() || "";
    if (!next || next === cursor) break;
    cursor = next;
  }
  return branches;
}

async function deleteBranch(options: FetchOptions, branch: NeonBranch): Promise<void> {
  if (!branch.id) return;
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(`${neonBase(options.projectId)}/${encodeURIComponent(branch.id)}`, {
    method: "DELETE",
    headers: neonHeaders(options.apiKey),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Could not delete a preview branch (${response.status}).`);
  }
}

/** Delete the Neon branch named exactly preview/<headRef>. An empty ref deletes nothing. */
export async function deleteClosedPreviewBranches(options: FetchOptions & { headRef: string }): Promise<string[]> {
  const ref = headRefFromEvent(options.headRef);
  if (!ref) return [];
  const branches = await listBranches(options);
  const deleted: string[] = [];
  for (const branch of branches) {
    if (!branch.id || !previewBranchDeletable(branch, ref)) continue;
    await deleteBranch(options, branch);
    deleted.push(String(branch.name || "").trim());
  }
  return deleted;
}

type PullRow = { state?: string; head?: { ref?: string } };

function repositoryParts(repository: string): { owner: string; repo: string } | null {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(repository.trim());
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

async function fetchPulls(
  parts: { owner: string; repo: string },
  ref: string,
  state: "open" | "closed",
  options: { token: string; fetchImpl?: typeof fetch },
): Promise<PullRow[]> {
  const fetchImpl = options.fetchImpl || fetch;
  const url = new URL(`https://api.github.com/repos/${encodeURIComponent(parts.owner)}/${encodeURIComponent(parts.repo)}/pulls`);
  url.searchParams.set("head", `${parts.owner}:${ref}`);
  url.searchParams.set("state", state);
  url.searchParams.set("per_page", "20");
  const response = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${options.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "neon-preview-cleanup",
    },
  });
  if (!response.ok) throw new Error(`GitHub pull request list failed (${response.status}).`);
  const body = (await response.json()) as unknown;
  if (!Array.isArray(body)) throw new Error("GitHub pull request list failed.");
  return body as PullRow[];
}

async function pullRequestState(options: {
  repository: string;
  token: string;
  headRef: string;
  fetchImpl?: typeof fetch;
}): Promise<"open" | "closed" | "none"> {
  const parts = repositoryParts(options.repository);
  const ref = headRefFromEvent(options.headRef);
  if (!parts || !ref || !options.token.trim()) return "none";
  const open = await fetchPulls(parts, ref, "open", options);
  if (open.some((row) => row.head?.ref === ref)) return "open";
  const closed = await fetchPulls(parts, ref, "closed", options);
  if (closed.some((row) => row.head?.ref === ref && row.state === "closed")) return "closed";
  return "none";
}

async function stalePreviewBranches(options: FetchOptions & { repository: string; token: string }): Promise<NeonBranch[]> {
  if (!options.token.trim() || !repositoryParts(options.repository)) return [];
  const branches = await listBranches(options);
  const stale: NeonBranch[] = [];
  for (const branch of branches) {
    const ref = refFromPreviewName(branch.name);
    if (!ref || !previewBranchDeletable(branch, ref)) continue;
    const state = await pullRequestState({
      repository: options.repository,
      token: options.token,
      headRef: ref,
      fetchImpl: options.fetchImpl,
    });
    if (state !== "closed") continue;
    stale.push(branch);
  }
  return stale;
}

function listedNames(branches: NeonBranch[]): string[] {
  return branches.map((branch) => String(branch.name || "").trim());
}

/** Closed-pull-request cleanup. A manual run lists stale branches and deletes only when dry run is off. */
export async function runPreviewCleanup(options: FetchOptions & {
  eventName: string;
  headRef: string;
  dryRun: boolean;
  repository: string;
  token: string;
}): Promise<CleanupReport> {
  if (options.eventName === "workflow_dispatch") {
    if (!options.token.trim() || !repositoryParts(options.repository)) {
      return { deleted: [], listed: [], message: "GitHub repository access is not set. Nothing deleted." };
    }
    const stale = await stalePreviewBranches(options);
    const listed = listedNames(stale);
    if (options.dryRun) {
      const message = listed.length
        ? `Dry run. Nothing deleted. Closed pull requests still have:\n${listed.map((name) => `- ${name}`).join("\n")}`
        : "Dry run. Nothing deleted. No stale preview branches.";
      return { deleted: [], listed, message };
    }
    const deleted: string[] = [];
    for (const branch of stale) {
      const ref = refFromPreviewName(branch.name);
      if (!branch.id || !previewBranchDeletable(branch, ref)) continue;
      await deleteBranch(options, branch);
      deleted.push(String(branch.name || "").trim());
    }
    const message = deleted.length ? `Deleted ${deleted.join(", ")}.` : "No stale preview branches to delete.";
    return { deleted, listed, message };
  }

  const ref = headRefFromEvent(options.headRef);
  if (!ref) return { deleted: [], listed: [], message: "No pull request head ref. Nothing deleted." };
  const deleted = await deleteClosedPreviewBranches(options);
  const message = deleted.length ? `Deleted ${deleted.join(", ")}.` : `No preview branch named preview/${ref} to delete.`;
  return { deleted, listed: [], message };
}
