import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://127.0.0.1:3456",
    viewport: { width: 1440, height: 900 },
    navigationTimeout: 60_000,
  },
  webServer: {
    command: "npx tsx e2e/server.ts",
    url: "http://127.0.0.1:3456/login",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
