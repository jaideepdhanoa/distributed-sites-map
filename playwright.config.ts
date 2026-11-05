import { defineConfig } from "@playwright/test";

const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 1 : 0,
  globalSetup: "./e2e/global-setup.ts",
  reporter: process.env.CI ? [["line"], ["github"]] : "line",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3456",
    storageState: "e2e/.auth.json",
    extraHTTPHeaders: bypass
      ? { "x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "true" }
      : {},
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    {
      name: "mobile",
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
});
