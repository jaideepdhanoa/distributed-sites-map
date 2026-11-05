import { defineConfig } from "@playwright/test";

const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const actionsOnly = process.env.E2E_ACTIONS === "1";
const authHeaders: Record<string, string> = bypass
  ? { "x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "true" }
  : {};

export default defineConfig({
  testDir: "e2e",
  timeout: actionsOnly ? 120_000 : 180_000,
  expect: { timeout: actionsOnly ? 30_000 : 15_000 },
  fullyParallel: !actionsOnly,
  workers: actionsOnly ? 1 : process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 1 : 0,
  globalSetup: actionsOnly ? undefined : "./e2e/global-setup.ts",
  reporter: process.env.CI ? [["line"], ["github"]] : "line",
  testIgnore: actionsOnly ? undefined : /(?:actions|queue)\.spec\.ts/,
  use: actionsOnly
    ? {
        baseURL: "http://127.0.0.1:3456",
        viewport: { width: 1440, height: 900 },
        navigationTimeout: 60_000,
      }
    : {
        baseURL: process.env.E2E_BASE_URL || "http://localhost:3456",
        storageState: "e2e/.auth.json",
        extraHTTPHeaders: authHeaders,
      },
  projects: actionsOnly
    ? [{ name: "actions", testMatch: /(?:actions|queue)\.spec\.ts/ }]
    : [
        { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
        {
          name: "mobile",
          use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
        },
      ],
  webServer: actionsOnly
    ? {
        command: "npx tsx e2e/server.ts",
        url: "http://127.0.0.1:3456/login",
        reuseExistingServer: false,
        timeout: 180_000,
      }
    : undefined,
});
