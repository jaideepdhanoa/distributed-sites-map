import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { assertPreviewTarget } from "../../lib/changes/guard";
import { memorySql } from "../helpers/sql";

const KEYS = [
  "VERCEL_ENV",
  "GITHUB_ACTIONS",
  "CI",
  "ALLOW_PRODUCTION_MIGRATE",
  "GITHUB_EVENT_NAME",
  "NEON_DATABASE_URL",
  "NEON_PRODUCTION_HOST",
  "NEON_BRANCH",
] as const;

test("migrations and the shadow job refuse production from CI and preview", async () => {
  const saved = new Map<string, string | undefined>(KEYS.map((key) => [key, process.env[key]]));
  const prod = "postgres://role:secret-value@prod.example.test/neondb";
  const preview = "postgres://role:secret-value@preview.example.test/neondb";
  const restore = () => {
    for (const key of KEYS) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    for (const key of KEYS) delete process.env[key];
    process.env.GITHUB_ACTIONS = "true";
    process.env.NEON_DATABASE_URL = prod;

    const refused = await memorySql();
    await assert.rejects(() => migrate(refused, { connectionString: prod }), (error: unknown) => {
      const message = error instanceof Error ? error.message : "";
      assert.match(message, /Refusing to migrate the production database/);
      assert.equal(message.includes("secret-value"), false);
      return true;
    });
    const untouched = await refused.query<{ name: string | null }>("SELECT to_regclass('public.events') AS name");
    assert.equal(untouched.rows[0]?.name, null);

    const previewFromCi = await memorySql();
    const appliedPreview = await migrate(previewFromCi, { connectionString: preview });
    assert.ok(appliedPreview.includes("009_events.sql"));

    const skipped = await memorySql();
    assert.deepEqual(await migrate(skipped, { connectionString: prod, onProduction: "skip" }), []);
    const stillMissing = await skipped.query<{ name: string | null }>("SELECT to_regclass('public.events') AS name");
    assert.equal(stillMissing.rows[0]?.name, null);

    delete process.env.GITHUB_ACTIONS;
    process.env.VERCEL_ENV = "production";
    const runtime = await memorySql();
    assert.deepEqual(await migrate(runtime, { connectionString: preview }), []);

    delete process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = "preview";
    await assert.rejects(async () => migrate(await memorySql(), { connectionString: prod }), /Refusing to migrate the production database/);

    delete process.env.VERCEL_ENV;
    assert.throws(() => assertPreviewTarget(preview, "backfill"), /NEON_BRANCH is preview/);
    process.env.NEON_BRANCH = "preview";
    assert.throws(() => assertPreviewTarget(preview, "diff"), /NEON_PRODUCTION_HOST is not set/);
    process.env.NEON_PRODUCTION_HOST = "prod.example.test";
    assert.doesNotThrow(() => assertPreviewTarget(preview, "diff"));
    assert.throws(() => assertPreviewTarget(prod, "backfill"), (error: unknown) => {
      const message = error instanceof Error ? error.message : "";
      assert.match(message, /Refusing to backfill the production database/);
      assert.equal(message.includes("secret-value"), false);
      return true;
    });
    process.env.VERCEL_ENV = "preview";
    assert.throws(() => assertPreviewTarget(preview, "backfill"), /Refusing to backfill from Vercel/);

    delete process.env.VERCEL_ENV;
    delete process.env.GITHUB_ACTIONS;
    process.env.ALLOW_PRODUCTION_MIGRATE = "1";
    process.env.GITHUB_EVENT_NAME = "workflow_dispatch";
    const manual = await memorySql();
    const applied = await migrate(manual, { connectionString: prod });
    assert.ok(applied.includes("009_events.sql"));
  } finally {
    restore();
  }
});
