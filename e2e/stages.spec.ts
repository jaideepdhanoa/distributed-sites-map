import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const username = process.env.E2E_USERNAME || "";
const password = process.env.E2E_PASSWORD || "";

test.beforeAll(() => {
  if (!username || !password) throw new Error("E2E_USERNAME and E2E_PASSWORD are required");
});

test("API stage counts match the workbook", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  const deals = await page.evaluate(async () => {
    const response = await fetch("/api/data/deals");
    if (!response.ok) throw new Error(String(response.status));
    return response.json();
  });
  const index = JSON.parse(readFileSync("data/workbook_stages.json", "utf8")) as {
    pipeline: Record<string, number>;
    land: Record<string, number>;
    rows: { deal_id: string; stage: string }[];
  };
  const features = deals.features as { properties: { deal_id: string; kind: string; stage: string } }[];
  const expected = new Map(index.rows.map((row) => [row.deal_id, row.stage]));
  for (const feature of features) {
    expect(feature.properties.stage).toBe(expected.get(feature.properties.deal_id));
  }
  const count = (kind: string) => {
    const totals: Record<string, number> = {};
    for (const feature of features) {
      if (feature.properties.kind !== kind) continue;
      totals[feature.properties.stage] = (totals[feature.properties.stage] || 0) + 1;
    }
    return totals;
  };
  expect(count("pipeline")).toEqual(index.pipeline);
  expect(count("land")).toEqual(index.land);
  await expect(page.locator("body")).toContainText(`Data as of ${JSON.parse(readFileSync("data/generated/funnel.json", "utf8")).workbook_as_of}`);
});
