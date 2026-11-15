export type NeonBranch = {
  id?: string;
  name?: string;
  primary?: boolean;
  default?: boolean;
  protected?: boolean;
};

const BLOCKED = new Set(["preview", "main", "production", "primary", "master"]);

/** Closed pull requests may delete preview/<name> branches only. The shared preview branch stays. */
export function previewBranchDeletable(branch: NeonBranch): boolean {
  if (branch.primary || branch.default || branch.protected) return false;
  const name = String(branch.name || "").trim();
  if (!name || BLOCKED.has(name.toLowerCase())) return false;
  return /^preview\/.+$/.test(name);
}

type BranchPage = { branches?: NeonBranch[]; pagination?: { cursor?: string } };

export async function deleteClosedPreviewBranches(options: {
  apiKey: string;
  projectId: string;
  fetchImpl?: typeof fetch;
}): Promise<string[]> {
  const fetchImpl = options.fetchImpl || fetch;
  const headers = { Authorization: `Bearer ${options.apiKey}`, Accept: "application/json" };
  const base = `https://console.neon.tech/api/v2/projects/${encodeURIComponent(options.projectId)}/branches`;
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
  const deleted: string[] = [];
  for (const branch of branches) {
    if (!previewBranchDeletable(branch) || !branch.id) continue;
    const response = await fetchImpl(`${base}/${encodeURIComponent(branch.id)}`, { method: "DELETE", headers });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Could not delete a preview branch (${response.status}).`);
    }
    deleted.push(String(branch.name));
  }
  return deleted;
}
