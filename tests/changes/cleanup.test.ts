import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  deleteClosedPreviewBranches,
  previewBranchDeletable,
  runPreviewCleanup,
  type NeonBranch,
} from "../../lib/changes/cleanup";

const API_KEY = "test-api-key";
const TOKEN = "test-github-token";
const CLOSED = "cursor/fix-alert-delivery-9b01";

type Call = { url: string; method: string };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function neonFetch(branches: NeonBranch[], calls: Call[]): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    const method = init?.method || "GET";
    calls.push({ url, method });
    assert.equal(url.includes(API_KEY), false);
    assert.equal(url.includes(TOKEN), false);
    if (url.startsWith("https://api.github.com/")) throw new Error("pull request cleanup listed GitHub pulls");
    if (method === "DELETE") return json({});
    return json({ branches });
  };
}

function deletedIds(calls: Call[]): string[] {
  return calls.filter((call) => call.method === "DELETE").map((call) => call.url.split("/").pop() || "");
}

test("other open pull request preview branches survive", async () => {
  const calls: Call[] = [];
  const branches: NeonBranch[] = [
    { id: "br-closed", name: `preview/${CLOSED}` },
    { id: "br-a", name: "preview/cursor/ceo-bundle-a-823d" },
    { id: "br-b", name: "preview/cursor/ceo-bundle-b-823d" },
    { id: "br-c", name: "preview/cursor/ceo-bundle-c-823d" },
    { id: "br-d", name: "preview/cursor/ceo-fast-path-823d" },
    { id: "br-preview", name: "preview" },
    { id: "br-main", name: "main", primary: true, default: true },
    { id: "br-prod", name: "production" },
  ];
  const deleted = await deleteClosedPreviewBranches({
    apiKey: API_KEY,
    projectId: "project-1",
    headRef: CLOSED,
    fetchImpl: neonFetch(branches, calls),
  });
  assert.deepEqual(deleted, [`preview/${CLOSED}`]);
  assert.deepEqual(deletedIds(calls), ["br-closed"]);
});

test("an exact preview/<ref> match is deleted", async () => {
  assert.equal(previewBranchDeletable({ name: "preview" }, "preview"), false);
  assert.equal(previewBranchDeletable({ name: "main" }, "main"), false);
  assert.equal(previewBranchDeletable({ name: "production" }, "production"), false);
  assert.equal(previewBranchDeletable({ name: `preview/${CLOSED}`, primary: true }, CLOSED), false);
  assert.equal(previewBranchDeletable({ name: `preview/${CLOSED}`, default: true }, CLOSED), false);
  assert.equal(previewBranchDeletable({ name: `preview/${CLOSED}`, protected: true }, CLOSED), false);
  assert.equal(previewBranchDeletable({ name: `preview/${CLOSED}` }, CLOSED), true);
  assert.equal(previewBranchDeletable({ name: `preview/${CLOSED}` }, `${CLOSED}-extra`), false);
  assert.equal(previewBranchDeletable({ name: `preview/${CLOSED}` }, ""), false);
  assert.equal(previewBranchDeletable({ name: "preview/production" }, "production"), true);
  assert.equal(previewBranchDeletable({ name: "production" }, "production"), false);

  const calls: Call[] = [];
  const branches: NeonBranch[] = [
    { id: "br-exact", name: `preview/${CLOSED}` },
    { id: "br-longer", name: `preview/${CLOSED}-extra` },
    { id: "br-shorter", name: "preview/cursor/fix-alert-delivery" },
    { id: "br-nested", name: `preview/${CLOSED}/more` },
    { id: "br-default", name: `preview/${CLOSED}`, default: true },
    { id: "br-primary", name: `preview/${CLOSED}`, primary: true },
    { id: "br-protected", name: `preview/${CLOSED}`, protected: true },
    { id: "br-preview", name: "preview" },
    { id: "br-main", name: "main", default: true },
    { id: "br-prod", name: "production" },
  ];
  const deleted = await deleteClosedPreviewBranches({
    apiKey: API_KEY,
    projectId: "project-1",
    headRef: `  ${CLOSED}  `,
    fetchImpl: neonFetch(branches, calls),
  });
  assert.deepEqual(deleted, [`preview/${CLOSED}`]);
  assert.deepEqual(deletedIds(calls), ["br-exact"]);
});

test("an empty head ref deletes nothing", async () => {
  let called = false;
  const fetchImpl: typeof fetch = async () => {
    called = true;
    throw new Error("fetch should not be called");
  };
  for (const headRef of ["", "   ", "\n", "\u0000cursor/x", "cursor/\nfoo", "*", "cursor/*", "$(rm -rf /)", "cursor/../main", "cursor//x", "owner:production", "preview/../production"]) {
    const deleted = await deleteClosedPreviewBranches({
      apiKey: API_KEY,
      projectId: "project-1",
      headRef,
      fetchImpl,
    });
    assert.deepEqual(deleted, []);
    const report = await runPreviewCleanup({
      apiKey: API_KEY,
      projectId: "project-1",
      eventName: "pull_request",
      headRef,
      dryRun: false,
      repository: "acme/widgets",
      token: TOKEN,
      fetchImpl,
    });
    assert.deepEqual(report.deleted, []);
    assert.match(report.message, /Nothing deleted/);
    assert.equal(report.message.includes(API_KEY), false);
    assert.equal(report.message.includes(TOKEN), false);
  }
  assert.equal(called, false);
});

test("a branch list failure does not include the api key", async () => {
  let caught: unknown;
  try {
    await deleteClosedPreviewBranches({
      apiKey: API_KEY,
      projectId: "project-1",
      headRef: CLOSED,
      fetchImpl: async () => new Response(`denied ${API_KEY}`, { status: 403 }),
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof Error);
  assert.match(caught.message, /Neon branch list failed \(403\)/);
  assert.equal(caught.message.includes(API_KEY), false);
});

const STALE_BRANCHES: NeonBranch[] = [
  { id: "br-old", name: "preview/cursor/old" },
  { id: "br-open", name: "preview/cursor/open" },
  { id: "br-orphan", name: "preview/cursor/orphan" },
  { id: "br-longer", name: "preview/cursor/old-extra" },
  { id: "br-default-preview", name: "preview/cursor/closed-default", default: true },
  { id: "br-preview", name: "preview" },
  { id: "br-main", name: "main", default: true },
  { id: "br-prod", name: "production" },
];

function staleFetch(calls: Call[]): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    const method = init?.method || "GET";
    calls.push({ url, method });
    assert.equal(url.includes(API_KEY), false);
    assert.equal(url.includes(TOKEN), false);
    if (url.startsWith("https://api.github.com/")) {
      const decoded = decodeURIComponent(url);
      const open = decoded.includes("state=open");
      if (decoded.includes("cursor/open") && open) return json([{ state: "open", head: { ref: "cursor/open" } }]);
      if (decoded.includes("cursor/old") && !decoded.includes("cursor/old-extra") && !open) {
        return json([{ state: "closed", head: { ref: "cursor/old" } }]);
      }
      if (decoded.includes("cursor/closed-default") && !open) {
        return json([{ state: "closed", head: { ref: "cursor/closed-default" } }]);
      }
      return json([]);
    }
    if (method === "DELETE") return json({});
    return json({ branches: STALE_BRANCHES });
  };
}

test("a manual dry run lists closed preview branches and deletes nothing", async () => {
  const calls: Call[] = [];
  const report = await runPreviewCleanup({
    apiKey: API_KEY,
    projectId: "project-1",
    eventName: "workflow_dispatch",
    headRef: "",
    dryRun: true,
    repository: "acme/widgets",
    token: TOKEN,
    fetchImpl: staleFetch(calls),
  });
  assert.deepEqual(report.deleted, []);
  assert.deepEqual(report.listed, ["preview/cursor/old"]);
  assert.match(report.message, /Nothing deleted/);
  assert.equal(report.message.includes(API_KEY), false);
  assert.equal(report.message.includes(TOKEN), false);
  assert.deepEqual(deletedIds(calls), []);
});

test("a manual run deletes only stale closed preview branches", async () => {
  const calls: Call[] = [];
  const report = await runPreviewCleanup({
    apiKey: API_KEY,
    projectId: "project-1",
    eventName: "workflow_dispatch",
    headRef: CLOSED,
    dryRun: false,
    repository: "acme/widgets",
    token: TOKEN,
    fetchImpl: staleFetch(calls),
  });
  assert.deepEqual(report.deleted, ["preview/cursor/old"]);
  assert.deepEqual(deletedIds(calls), ["br-old"]);
  assert.equal(report.message.includes(API_KEY), false);
});

test("a manual run without repository access deletes nothing", async () => {
  const fetchImpl: typeof fetch = async () => {
    throw new Error("fetch should not be called");
  };
  for (const options of [
    { token: "", repository: "acme/widgets" },
    { token: TOKEN, repository: "https://evil.example/acme/widgets" },
  ]) {
    const report = await runPreviewCleanup({
      apiKey: API_KEY,
      projectId: "project-1",
      eventName: "workflow_dispatch",
      headRef: "",
      dryRun: false,
      repository: options.repository,
      token: options.token,
      fetchImpl,
    });
    assert.deepEqual(report.deleted, []);
    assert.match(report.message, /Nothing deleted/);
  }
});

test("closing a pull request does not sweep other preview branches", async () => {
  const calls: Call[] = [];
  const report = await runPreviewCleanup({
    apiKey: API_KEY,
    projectId: "project-1",
    eventName: "pull_request",
    headRef: CLOSED,
    dryRun: false,
    repository: "acme/widgets",
    token: TOKEN,
    fetchImpl: neonFetch(
      [
        { id: "br-closed", name: `preview/${CLOSED}` },
        { id: "br-open", name: "preview/cursor/open" },
      ],
      calls,
    ),
  });
  assert.deepEqual(report.deleted, [`preview/${CLOSED}`]);
  assert.deepEqual(deletedIds(calls), ["br-closed"]);
  assert.equal(calls.some((call) => call.url.includes("api.github.com")), false);
});

function shellScripts(yaml: string): string[] {
  const lines = yaml.split("\n");
  const scripts: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const header = /^(\s*)run:\s*(.*)$/.exec(lines[i]);
    if (!header) continue;
    if (header[2] && header[2] !== "|") {
      scripts.push(header[2]);
      continue;
    }
    const indent = header[1].length;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j];
      if (line.trim() === "") {
        body.push(line);
        continue;
      }
      const lead = line.match(/^ */)?.[0].length ?? 0;
      if (lead <= indent) break;
      body.push(line);
    }
    scripts.push(body.join("\n"));
  }
  return scripts;
}

test("the workflow passes the head ref through the environment", () => {
  const root = join(process.cwd(), ".github/workflows/neon-preview-cleanup.yml");
  const yaml = readFileSync(root, "utf8");
  const script = readFileSync(join(process.cwd(), "scripts/neon-preview-cleanup.ts"), "utf8");
  assert.match(yaml, /pull_request:\n {4}types: \[closed\]/);
  assert.match(yaml, /dry_run:[\s\S]*?default: true/);
  assert.match(yaml, /PR_HEAD_REF: \$\{\{ github\.event\.pull_request\.head\.ref \}\}/);
  assert.match(script, /process\.env\.PR_HEAD_REF/);
  const shells = shellScripts(yaml);
  assert.ok(shells.length > 0);
  for (const shell of shells) {
    assert.doesNotMatch(shell, /\$\{\{/);
    assert.doesNotMatch(shell, /github\.event/);
    assert.doesNotMatch(shell, /secrets\./);
    for (const line of shell.split("\n")) {
      const code = line.replace(/#.*/, "");
      if (!code.includes("PR_HEAD_REF")) continue;
      assert.match(code, /"\$\{PR_HEAD_REF-\}"|"\$PR_HEAD_REF"/);
      assert.doesNotMatch(code, /(^|[^\{])\$PR_HEAD_REF/);
    }
  }
  assert.match(shells.join("\n"), /PR_HEAD_REF="\$\{PR_HEAD_REF-\}" npx tsx scripts\/neon-preview-cleanup\.ts/);
});
