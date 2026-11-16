import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET as alertFlushCron } from "../../lib/api/handlers/cron/alert-flush.ts";
import { GET as workbookSyncCron } from "../../lib/api/handlers/cron/workbook-sync.ts";
import { dispatch } from "../../lib/api/dispatch.ts";
import {
  ACTIVE_WORKFLOW_STATUSES,
  CRON_JOBS,
  DISPATCH_REF,
  DISPATCH_REPOSITORY,
  dispatchRepositoryWorkflow,
} from "../../lib/cron/dispatch.ts";

const CRON_SECRET = "cron-secret-value";
const TOKEN = "dispatch-token-value";

type Call = { url: string; method: string; body: string; authorization: string; cache: string; redirect: string };

function callsOf(impl: { calls: Call[] }): Call[] {
  return impl.calls;
}

function mockFetch(sequence: Array<(url: string) => Response>) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      method: init?.method || "GET",
      body: typeof init?.body === "string" ? init.body : "",
      authorization: headers.get("authorization") || "",
      cache: init?.cache || "",
      redirect: init?.redirect || "",
    });
    const next = sequence.shift();
    if (!next) throw new Error(`unexpected fetch ${url}`);
    return next(url);
  };
  return { fetchImpl, calls };
}

function runs(rows: unknown[]): Response {
  return Response.json({ workflow_runs: rows, extra: TOKEN });
}

function posted(): Response {
  return new Response(null, { status: 204 });
}

async function withLogs(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const previous = console.log;
  console.log = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    await fn();
  } finally {
    console.log = previous;
  }
  return lines;
}

function assertNoCredential(text: string) {
  assert.equal(text.includes(TOKEN), false);
  assert.equal(text.includes(CRON_SECRET), false);
  assert.equal(text.includes("github_pat_"), false);
  assert.equal(text.includes("ghp_"), false);
}

function assertNoLeak(text: string) {
  assertNoCredential(text);
  assert.equal(text.includes("Asking price"), false);
}

test("vercel cron matches the two dispatch routes and keeps the digest", () => {
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] };
  assert.deepEqual(vercel.crons, [
    { path: "/api/alerts/digest", schedule: "0 14 * * *" },
    { path: "/api/alerts/digest", schedule: "0 15 * * *" },
    ...CRON_JOBS.map((job) => ({ path: job.path, schedule: job.schedule })),
  ]);
  const readme = readFileSync("README.md", "utf8");
  const example = readFileSync(".env.example", "utf8");
  assert.match(readme, /\| `GITHUB_DISPATCH_TOKEN` \|/);
  assert.match(example, /^# GITHUB_DISPATCH_TOKEN=$/m);
  assertNoCredential(readme);
  assertNoCredential(example);
  assert.equal(readFileSync("lib/cron/dispatch.ts", "utf8").includes("github_pat_"), false);
});

test("the github schedules stay, and a cancelled run still saves the snapshot fingerprint", () => {
  const sync = readFileSync(".github/workflows/workbook-sync.yml", "utf8");
  const flush = readFileSync(".github/workflows/alert-flush.yml", "utf8");
  assert.match(sync, /cron: "\*\/15 \* \* \* \*"/);
  assert.match(sync, /workflow_dispatch:/);
  assert.match(sync, /cancel-in-progress: false/);
  assert.match(sync, /always\(\) && \(steps\.publish\.outputs\.published == 'true' \|\| steps\.live\.outputs\.unchanged == 'true'\)/);
  assert.match(sync, /always\(\) && steps\.record-hash\.outcome == 'success'/);
  assert.match(flush, /cron: "\*\/5 \* \* \* \*"/);
  assert.match(flush, /workflow_dispatch:/);
  const names = [...sync.matchAll(/^ {6}- name: (.+)$/gm)].map((hit) => hit[1]);
  const mirror = names.indexOf("Mirror database rows into the workbook");
  const record = names.indexOf("Record the published hash");
  const save = names.indexOf("Save the published hash");
  assert.ok(mirror > 0);
  assert.equal(save, record + 1);
  assert.ok(record > mirror);
});

test("an active run skips dispatch and the log is only that run id", async () => {
  for (const status of ACTIVE_WORKFLOW_STATUSES) {
    const logs: string[] = [];
    const github = mockFetch([
      () => runs([
        { id: 10, status: "completed", conclusion: "cancelled", html_url: `https://example.test/${TOKEN}`, display_title: "Asking price 9" },
        { id: 12, status, name: TOKEN },
        { id: 11, status: "queued" },
      ]),
    ]);
    const result = await dispatchRepositoryWorkflow({
      workflow: "workbook-sync.yml",
      token: TOKEN,
      fetchImpl: github.fetchImpl,
      log: (line) => logs.push(line),
      sleep: async () => undefined,
    });
    assert.deepEqual(result, { ok: true, skipped: true, run_id: 12 });
    assert.equal(github.calls.some((call) => call.method === "POST"), false);
    assert.equal(logs.length, 1);
    assert.deepEqual(JSON.parse(logs[0] || "{}"), { event: "workflow_dispatch_skipped", workflow: "workbook-sync.yml", run_id: 12 });
    assertNoLeak(logs.join("\n"));
    assert.equal(github.calls[0]?.url.includes(TOKEN), false);
  }
});

test("a finished run is dispatched and only the new run id is logged", async () => {
  const logs: string[] = [];
  const slept: number[] = [];
  const github = mockFetch([
    () => runs([{ id: 7, status: "completed", conclusion: "success", head_commit: { message: `Asking price ${TOKEN}` } }]),
    () => posted(),
    () => runs([{ id: 7, status: "completed" }]),
    () => runs([{ id: 8, status: "queued", logs_url: `https://example.test/${TOKEN}` }]),
  ]);
  const result = await dispatchRepositoryWorkflow({
    workflow: "alert-flush.yml",
    token: `  ${TOKEN}  `,
    fetchImpl: github.fetchImpl,
    log: (line) => logs.push(line),
    sleep: async (ms) => {
      slept.push(ms);
    },
  });
  assert.deepEqual(result, { ok: true, skipped: false, run_id: 8 });
  assert.deepEqual(slept, [300]);
  assert.equal(logs.length, 1);
  assert.deepEqual(JSON.parse(logs[0] || "{}"), { event: "workflow_dispatch", workflow: "alert-flush.yml", run_id: 8 });
  assertNoLeak(logs.join("\n"));
  const post = github.calls.find((call) => call.method === "POST");
  assert.ok(post);
  assert.equal(post.url, `https://api.github.com/repos/${DISPATCH_REPOSITORY}/actions/workflows/alert-flush.yml/dispatches`);
  assert.equal(post.body, JSON.stringify({ ref: DISPATCH_REF }));
  assert.equal(post.authorization, `Bearer ${TOKEN}`);
  assert.equal(post.cache, "no-store");
  assert.equal(post.redirect, "manual");
  assert.equal(post.url.includes(TOKEN), false);
  assert.match(github.calls[0]?.url || "", /\/runs\?per_page=30$/);
});

test("a dispatch that is not visible yet logs nothing and does not invent a run id", async () => {
  const logs: string[] = [];
  const github = mockFetch([
    () => runs([{ id: 3, status: "completed" }]),
    () => posted(),
    () => runs([{ id: 3, status: "completed" }]),
    () => runs([{ id: 3, status: "completed" }]),
    () => runs([{ id: 3, status: "completed" }]),
    () => runs([{ id: 3, status: "completed" }]),
  ]);
  const result = await dispatchRepositoryWorkflow({
    workflow: "workbook-sync.yml",
    token: TOKEN,
    fetchImpl: github.fetchImpl,
    log: (line) => logs.push(line),
    sleep: async () => undefined,
  });
  assert.deepEqual(result, { ok: true, skipped: false, run_id: null });
  assert.deepEqual(logs, []);
  assert.equal(github.calls.filter((call) => call.method === "POST").length, 1);
});

test("a github error is not dispatched twice and its body stays out of the log", async () => {
  const logs: string[] = [];
  const github = mockFetch([
    () => runs([]),
    () => Response.json({ message: TOKEN, detail: "Asking price 9", token: TOKEN }, { status: 401 }),
  ]);
  const result = await dispatchRepositoryWorkflow({
    workflow: "workbook-sync.yml",
    token: TOKEN,
    fetchImpl: github.fetchImpl,
    log: (line) => logs.push(line),
  });
  assert.deepEqual(result, { ok: false, error: "The workflow could not be dispatched.", github_status: 401 });
  assert.equal(github.calls.filter((call) => call.method === "POST").length, 1);
  assert.deepEqual(JSON.parse(logs[0] || "{}"), { event: "workflow_dispatch_failed", workflow: "workbook-sync.yml", github_status: 401 });
  assertNoLeak(logs.join("\n"));
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
});

test("a failed run list does not dispatch", async () => {
  const github = mockFetch([() => new Response(`Asking price ${TOKEN}`, { status: 500 })]);
  const logs: string[] = [];
  const result = await dispatchRepositoryWorkflow({
    workflow: "alert-flush.yml",
    token: TOKEN,
    fetchImpl: github.fetchImpl,
    log: (line) => logs.push(line),
  });
  assert.equal(result.ok, false);
  assert.equal(github.calls.some((call) => call.method === "POST"), false);
  assertNoLeak(logs.join("\n"));
  assertNoLeak(JSON.stringify(result));
});

test("a redirect is not followed", async () => {
  const github = mockFetch([
    () => runs([]),
    () => new Response(null, { status: 302, headers: { location: `https://example.test/${TOKEN}` } }),
  ]);
  const result = await dispatchRepositoryWorkflow({
    workflow: "workbook-sync.yml",
    token: TOKEN,
    fetchImpl: github.fetchImpl,
    log: () => undefined,
  });
  assert.equal(result.ok, false);
  assert.equal(github.calls.length, 2);
  assert.equal(github.calls.some((call) => call.url.includes("example.test")), false);
});

test("a missing token never calls github", async () => {
  let called = false;
  const result = await dispatchRepositoryWorkflow({
    workflow: "workbook-sync.yml",
    token: "  ",
    fetchImpl: async () => {
      called = true;
      return runs([]);
    },
  });
  assert.deepEqual(result, { ok: false, error: "GITHUB_DISPATCH_TOKEN is not set.", github_status: null });
  assert.equal(called, false);
});

test("the cron routes require CRON_SECRET and dispatch only their own workflow", async () => {
  const previous = { cron: process.env.CRON_SECRET, token: process.env.GITHUB_DISPATCH_TOKEN, fetch: globalThis.fetch };
  const lines: string[] = [];
  const previousLog = console.log;
  console.log = (line?: unknown) => {
    lines.push(String(line));
  };
  process.env.CRON_SECRET = CRON_SECRET;
  delete process.env.GITHUB_DISPATCH_TOKEN;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    throw new Error("fetch should not run");
  };
  try {
    const missingSecret = await workbookSyncCron(new Request("http://localhost/api/cron/workbook-sync"));
    assert.equal(missingSecret.status, 401);
    assert.deepEqual(await missingSecret.json(), { error: "Unauthorized" });

    const wrong = await alertFlushCron(new Request("http://localhost/api/cron/alert-flush", {
      headers: { authorization: "Bearer nope" },
    }));
    assert.equal(wrong.status, 401);
    assert.equal(fetches, 0);

    const unconfigured = await workbookSyncCron(new Request("http://localhost/api/cron/workbook-sync?workflow=alert-flush.yml", {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    }));
    assert.equal(unconfigured.status, 500);
    assert.deepEqual(await unconfigured.json(), { error: "GITHUB_DISPATCH_TOKEN is not set." });
    assert.equal(unconfigured.headers.get("cache-control"), "private, no-store");
    assert.equal(fetches, 0);
    assert.deepEqual(JSON.parse(lines.at(-1) || "{}"), { event: "workflow_dispatch_unconfigured", workflow: "workbook-sync.yml" });
    assertNoLeak(lines.join("\n"));

    process.env.GITHUB_DISPATCH_TOKEN = TOKEN;
    const github = mockFetch([
      () => runs([{ id: 4, status: "completed" }]),
      () => posted(),
      () => runs([{ id: 4, status: "completed" }, { id: 5, status: "in_progress" }]),
    ]);
    globalThis.fetch = github.fetchImpl;
    const started = await workbookSyncCron(new Request("http://localhost/api/cron/workbook-sync", {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    }));
    assert.equal(started.status, 200);
    assert.deepEqual(await started.json(), { ok: true, skipped: false, run_id: 5 });
    const post = github.calls.find((call) => call.method === "POST");
    assert.match(post?.url || "", /\/workbook-sync\.yml\/dispatches$/);
    assert.equal(post?.authorization, `Bearer ${TOKEN}`);
    assert.equal(post?.authorization.includes(CRON_SECRET), false);

    const busy = mockFetch([() => runs([{ id: 9, status: "queued" }])]);
    globalThis.fetch = busy.fetchImpl;
    const skipped = await alertFlushCron(new Request("http://localhost/api/cron/alert-flush", {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    }));
    assert.equal(skipped.status, 200);
    assert.deepEqual(await skipped.json(), { ok: true, skipped: true, run_id: 9 });
    assert.equal(busy.calls.some((call) => call.method === "POST"), false);
    assert.match(busy.calls[0]?.url || "", /\/alert-flush\.yml\/runs/);

    const denied = mockFetch([
      () => runs([]),
      () => Response.json({ message: TOKEN, broker: "Asking price" }, { status: 401 }),
    ]);
    globalThis.fetch = denied.fetchImpl;
    const failed = await alertFlushCron(new Request("http://localhost/api/cron/alert-flush", {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    }));
    assert.equal(failed.status, 502);
    const failedBody = await failed.text();
    assert.equal(failedBody.includes(TOKEN), false);
    assert.equal(failedBody.includes("Asking price"), false);
    assert.match(failedBody, /could not be dispatched/);
    assertNoLeak(lines.join("\n"));
    assert.equal(callsOf(github).length > 0, true);
  } finally {
    console.log = previousLog;
    globalThis.fetch = previous.fetch;
    if (previous.cron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous.cron;
    if (previous.token === undefined) delete process.env.GITHUB_DISPATCH_TOKEN;
    else process.env.GITHUB_DISPATCH_TOKEN = previous.token;
  }
});

test("cron routes are on the catch-all and reject the other methods", async () => {
  const parts = ["cron", "workbook-sync"];
  const options = await dispatch("OPTIONS", new NextRequest("http://localhost/api/cron/workbook-sync"), parts);
  assert.equal(options.headers.get("allow"), "GET, HEAD, OPTIONS");
  const postedRoute = await dispatch("POST", new NextRequest("http://localhost/api/cron/workbook-sync"), parts);
  assert.equal(postedRoute.status, 405);
  assert.equal(await postedRoute.text(), "");
  const source = readFileSync("lib/api/dispatch.ts", "utf8");
  assert.match(source, /parts\[0\] === "cron"/);
});
