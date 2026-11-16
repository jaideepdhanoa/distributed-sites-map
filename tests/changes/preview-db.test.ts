import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../../lib/api/handlers/changes";
import { GET as digest } from "../../lib/api/handlers/alerts/digest";
import { blocksPreviewWrite, dispatch } from "../../lib/api/dispatch";
import { workbookMirrorEnabled } from "../../lib/changes/mirror";
import { sameDatabaseHost } from "../../lib/changes/host";
import { transportKind } from "../../lib/alerts/transport";
import { askReady } from "../../lib/ask/model";
import { renderToStaticMarkup } from "react-dom/server";
import { PreviewDbBannerView } from "../../components/PreviewDbBanner";
import { isolatedKey, PREVIEW_POINTS_AT_PRODUCTION, previewPointsAtProduction } from "../../lib/preview/safety";
import {
  keysForPreviewSplit,
  planPreviewEnv,
  recordsAfterNarrow,
  sharedPreviewStillAttached,
} from "../../lib/preview/env-plan";
import { previewHostsMatchProduction, previewTargetValues } from "../../lib/preview/env-values";
import { createPreviewBody, ensurePreviewBranch, planPreviewBranch, restorePreviewBody } from "../../lib/preview/neon";
import { redactSecrets } from "../../lib/preview/redact";
import {
  applyPreviewEnv,
  PUBLIC_VERCEL_PROJECT_ID,
  PUBLIC_VERCEL_TEAM_ID,
  redeployBody,
  selectPreviewDeployment,
} from "../../lib/preview/vercel";

const PROD = "postgres://role:secret-value@ep-prod-pooler.example.test/neondb";
const PREVIEW = "postgres://role:secret-value@ep-preview-pooler.example.test/neondb";
const DIRECT = "postgres://role:secret-value@ep-preview.example.test/neondb";

const ENV_KEYS = [
  "VERCEL_ENV",
  "DATABASE_URL",
  "NEON_PRODUCTION_HOST",
  "NEON_DATABASE_URL",
  "PREVIEW_DATABASE_BRANCH",
  "RESEND_API_KEY",
  "RESEND_EMAIL_DOMAIN",
  "SMTP_USER",
  "SMTP_PASS",
  "XAI_API_KEY",
  "WORKBOOK_MIRROR_ENABLED",
] as const;

function restoreEnv(saved: Map<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("preview writes refuse the production host and other hosts stay open", async () => {
  const saved = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  try {
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.VERCEL_ENV = "preview";
    process.env.DATABASE_URL = PROD;
    process.env.NEON_PRODUCTION_HOST = "ep-prod.example.test";
    assert.equal(previewPointsAtProduction(), true);
    assert.equal(sameDatabaseHost("ep-prod-pooler.example.test", "ep-prod.example.test"), true);

    const changes = await POST(new Request("http://localhost/api/changes", { method: "POST", body: "{}" }));
    assert.equal(changes.status, 503);
    assert.equal(((await changes.json()) as { error: string }).error, PREVIEW_POINTS_AT_PRODUCTION);

    const login = await dispatch(
      "POST",
      new NextRequest("http://localhost/api/login", { method: "POST" }),
      ["login"],
    );
    assert.equal(login.status, 503);
    assert.equal(((await login.json()) as { error: string }).error, "Preview is pointed at production");

    const digestResponse = await dispatch(
      "GET",
      new NextRequest("http://localhost/api/alerts/digest"),
      ["alerts", "digest"],
    );
    assert.equal(digestResponse.status, 503);
    assert.equal(blocksPreviewWrite("GET", ["data", "deals"]), false);
    assert.equal(blocksPreviewWrite("GET", ["cron", "workbook-sync"]), true);
    assert.equal(blocksPreviewWrite("POST", ["changes"]), true);
    assert.equal(blocksPreviewWrite("PUT", ["alerts", "preferences"]), true);

    process.env.DATABASE_URL = PREVIEW;
    process.env.NEON_PRODUCTION_HOST = "ep-prod.example.test";
    delete process.env.PREVIEW_DATABASE_BRANCH;
    assert.equal(previewPointsAtProduction(), true);
    process.env.PREVIEW_DATABASE_BRANCH = "preview";
    assert.equal(previewPointsAtProduction(), false);
    const open = await POST(new Request("http://localhost/api/changes", { method: "POST" }));
    assert.notEqual(open.status, 503);

    process.env.VERCEL_ENV = "production";
    process.env.DATABASE_URL = PROD;
    assert.equal(previewPointsAtProduction(), false);

    process.env.VERCEL_ENV = "preview";
    process.env.DATABASE_URL = PREVIEW;
    process.env.PREVIEW_DATABASE_BRANCH = "preview";
    process.env.NEON_PRODUCTION_HOST = "ep-prod.example.test";
    const job = await digest(new Request("http://localhost/api/alerts/digest"));
    assert.equal(job.status, 403);
    assert.match(((await job.json()) as { error: string }).error, /only in production/);

    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_EMAIL_DOMAIN = "example.test";
    assert.equal(transportKind(), null);
    process.env.XAI_API_KEY = "xai-test";
    assert.equal(askReady(), false);
    assert.equal(isolatedKey("sites:fail:person"), "preview:sites:fail:person");
    process.env.WORKBOOK_MIRROR_ENABLED = "1";
    assert.equal(workbookMirrorEnabled(), false);

    delete process.env.VERCEL_ENV;
    assert.equal(isolatedKey("ask:cap:person:2026-01-01"), "ask:cap:person:2026-01-01");
    assert.equal(transportKind(), "resend");
    assert.equal(askReady(), true);
  } finally {
    restoreEnv(saved);
  }
});

test("the preview env plan never writes production", () => {
  const records = [
    { id: "db", key: "DATABASE_URL", target: ["production", "preview"] },
    { id: "flag", key: "CHANGES_API_ENABLED", target: ["production"] },
    { id: "mail", key: "RESEND_API_KEY", target: ["production", "preview"] },
  ];
  const keys = keysForPreviewSplit(records);
  assert.ok(keys.includes("DATABASE_URL"));
  assert.ok(keys.includes("NEON_PRODUCTION_HOST"));
  assert.ok(keys.includes("PREVIEW_DATABASE_BRANCH"));
  assert.equal(keys.includes("RESEND_API_KEY"), false);
  assert.equal(keys.includes("CHANGES_API_ENABLED"), false);
  const plan = planPreviewEnv(records, keys);
  assert.deepEqual(plan.narrow.find((step) => step.key === "DATABASE_URL")?.target, ["production"]);
  for (const step of plan.write) assert.deepEqual([...step.target], ["preview"]);
  assert.equal(plan.write.some((step) => step.key === "RESEND_API_KEY"), false);
  assert.equal(sharedPreviewStillAttached(records, "DATABASE_URL"), true);
  assert.equal(sharedPreviewStillAttached(recordsAfterNarrow(records, plan), "DATABASE_URL"), false);
  assert.throws(() => planPreviewEnv(records, ["RESEND_API_KEY"]), /Refusing to change RESEND_API_KEY/);
});

test("preview connection values refuse the production host and stay masked", () => {
  assert.equal(previewHostsMatchProduction(PREVIEW, DIRECT, "ep-prod.example.test"), false);
  assert.throws(() => previewTargetValues({ pooled: PROD, direct: PROD, productionHost: "ep-prod.example.test" }), /production database host/);
  const values = previewTargetValues({ pooled: PREVIEW, direct: DIRECT, productionHost: "ep-prod.example.test" });
  assert.equal(values.get("DATABASE_URL")?.value, PREVIEW);
  assert.equal(values.get("PGHOST")?.value, "ep-preview-pooler.example.test");
  assert.equal(values.get("NEON_PRODUCTION_HOST")?.type, "plain");
  assert.equal(values.get("NEON_PRODUCTION_HOST")?.value, "ep-prod.example.test");
  assert.deepEqual(values.get("PREVIEW_DATABASE_BRANCH"), { value: "preview", type: "plain" });
  const redacted = redactSecrets(`failed ${PREVIEW}`, [PREVIEW]);
  assert.equal(redacted.includes("secret-value"), false);
});

test("neon keeps one preview branch and does not preserve a second copy", async () => {
  assert.deepEqual(planPreviewBranch([{ id: "br-main", name: "main", default: true }]), { action: "create", parentId: "br-main" });
  assert.deepEqual(restorePreviewBody("br-main"), { source_branch_id: "br-main" });
  assert.equal("preserve_under_name" in restorePreviewBody("br-main"), false);
  assert.equal(createPreviewBody("br-main").endpoints.length, 1);
  assert.throws(
    () => planPreviewBranch([{ id: "br-main", name: "main", default: true }, { id: "br-preview", name: "preview", primary: true }]),
    /primary, default, or protected/,
  );

  const calls: { method: string; url: string; body: string }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method || "GET";
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ method, url, body });
    if (method === "DELETE") throw new Error("refusing to delete a branch");
    const json = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200 });
    if (url.includes("/branches?limit=100")) {
      return json({
        branches: [
          { id: "br-main", name: "main", default: true, primary: true },
          { id: "br-preview", name: "preview" },
        ],
      });
    }
    if (url.endsWith("/restore")) return json({ operations: [{ id: "op-1", status: "finished" }] });
    if (url.endsWith("/endpoints")) return json({ endpoints: [{ id: "ep-1", branch_id: "br-preview", type: "read_write" }] });
    if (url.includes("/databases")) return json({ databases: [{ name: "neondb", owner_name: "preview_owner" }] });
    if (url.includes("pooled=true")) return json({ uri: PREVIEW });
    if (url.includes("pooled=false")) return json({ uri: DIRECT });
    throw new Error(`unexpected ${method} ${url}`);
  };
  const result = await ensurePreviewBranch({
    apiKey: "neon-test-key",
    projectId: "proj-test",
    fetchImpl,
    sleep: async () => undefined,
  });
  assert.equal(result.action, "restored");
  assert.equal(result.pooled, PREVIEW);
  const restore = calls.find((call) => call.url.endsWith("/restore"));
  assert.ok(restore);
  assert.deepEqual(JSON.parse(restore.body), { source_branch_id: "br-main" });
  assert.equal(calls.some((call) => call.method === "DELETE"), false);
  assert.equal(calls.some((call) => call.method === "POST" && call.url.endsWith("/endpoints")), false);
  assert.equal(calls.some((call) => call.url.includes("secret-value")), false);
});

test("vercel preview writes do not include production", async () => {
  const records = [{ id: "db", key: "DATABASE_URL", target: ["preview", "production"] }];
  const values = previewTargetValues({ pooled: PREVIEW, direct: DIRECT, productionHost: "ep-prod.example.test" });
  const calls: { method: string; body: string }[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ method: init?.method || "GET", body });
    return new Response("{}", { status: 200 });
  };
  const written = await applyPreviewEnv(
    { token: "vercel-test-token", projectId: "prj_test", teamId: "team_test", fetchImpl },
    records,
    values,
  );
  assert.ok(written.includes("DATABASE_URL"));
  const patch = calls.find((call) => call.method === "PATCH");
  assert.ok(patch);
  assert.deepEqual(JSON.parse(patch.body), { target: ["production"] });
  assert.equal(patch.body.includes("secret-value"), false);
  const posts = calls.filter((call) => call.method === "POST");
  assert.ok(posts.length >= 1);
  for (const post of posts) {
    const parsed = JSON.parse(post.body) as { target: string[] };
    assert.deepEqual(parsed.target, ["preview"]);
    assert.equal(parsed.target.includes("production"), false);
  }
  assert.equal(selectPreviewDeployment([
    { uid: "dpl_prod", target: "production", readyState: "READY" },
    { uid: "dpl_preview", target: null, readyState: "READY" },
  ])?.uid, "dpl_preview");
  assert.equal(redeployBody("sites", "dpl_preview").target, "preview");
});

test("preview fails closed until the reset marker says the host is not production", () => {
  const saved = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  try {
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.VERCEL_ENV = "preview";
    process.env.DATABASE_URL = PROD;
    const closed = renderToStaticMarkup(PreviewDbBannerView());
    assert.equal(previewPointsAtProduction(), true);
    assert.match(closed, /preview-db-banner/);
    assert.match(closed, /Preview is pointed at production/);

    process.env.PREVIEW_DATABASE_BRANCH = "preview";
    process.env.DATABASE_URL = PREVIEW;
    process.env.NEON_PRODUCTION_HOST = "ep-prod.example.test";
    assert.equal(previewPointsAtProduction(), false);
    assert.equal(renderToStaticMarkup(PreviewDbBannerView()), "");

    process.env.DATABASE_URL = PROD;
    assert.equal(previewPointsAtProduction(), true);
    assert.match(renderToStaticMarkup(PreviewDbBannerView()), /Preview is pointed at production/);
  } finally {
    restoreEnv(saved);
  }
});

test("preview workflows confirm, mask, and stay off production", () => {
  const reset = readFileSync(".github/workflows/reset-preview-db.yml", "utf8");
  const migrate = readFileSync(".github/workflows/preview-migrate.yml", "utf8");
  const validate = readFileSync(".github/workflows/validate-data.yml", "utf8");
  assert.match(reset, /confirm:/);
  assert.match(reset, /reset-preview-db/);
  assert.match(reset, /set \+x/);
  assert.match(reset, /::add-mask::/);
  assert.doesNotMatch(reset, /(?:^|\s)set -x\b/);
  assert.doesNotMatch(reset, /secrets\.NEON_DATABASE_URL/);
  assert.match(reset, /secrets\.NEON_API_KEY/);
  assert.match(reset, /secrets\.VERCEL_TOKEN/);
  assert.match(migrate, /migrate-preview/);
  assert.match(migrate, /set \+x/);
  assert.doesNotMatch(migrate, /(?:^|\s)set -x\b/);
  assert.doesNotMatch(migrate, /NEON_DATABASE_URL/);
  assert.doesNotMatch(migrate, /target: production/);
  assert.ok(validate.includes(PUBLIC_VERCEL_PROJECT_ID));
  assert.ok(validate.includes(PUBLIC_VERCEL_TEAM_ID));
  const banner = readFileSync("components/PreviewDbBanner.tsx", "utf8");
  const layout = readFileSync("app/layout.tsx", "utf8");
  const safety = readFileSync("lib/preview/safety.ts", "utf8");
  assert.match(banner, /await connection\(\)/);
  assert.match(banner, /PREVIEW_POINTS_AT_PRODUCTION/);
  assert.match(safety, /Preview is pointed at production/);
  assert.match(layout, /PreviewDbBanner/);
  assert.equal(banner.includes("<button"), false);
});
