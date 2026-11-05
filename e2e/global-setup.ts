import { chromium, type Browser } from "@playwright/test";
import fs from "node:fs";

export default async function globalSetup() {
  const username = process.env.E2E_USERNAME || "";
  const password = process.env.E2E_PASSWORD || "";
  if (!username || !password) throw new Error("E2E_USERNAME and E2E_PASSWORD are required");
  const baseURL = process.env.E2E_BASE_URL || "http://localhost:3456";
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const headers: Record<string, string> = bypass
    ? { "x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "true" }
    : {};
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({ baseURL, extraHTTPHeaders: headers });
    const page = await context.newPage();
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    const status = await page.evaluate(async (body) => {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return response.status;
    }, { username, password });
    if (status !== 200) throw new Error(`Sign-in failed (${status})`);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".shell", { timeout: 30_000 });
    fs.mkdirSync("e2e", { recursive: true });
    await context.storageState({ path: "e2e/.auth.json" });
  } finally {
    await browser?.close();
  }
}
