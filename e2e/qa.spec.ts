import { expect, test } from "@playwright/test";

const username = process.env.E2E_USERNAME || "";
const password = process.env.E2E_PASSWORD || "";

test.beforeAll(() => {
  if (!username || !password) {
    throw new Error("E2E_USERNAME and E2E_PASSWORD are required");
  }
});

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  await page.waitForSelector(".shell");
}

test("changes note uses the published-build counts", async ({ page }) => {
  await signIn(page);
  const payload = await page.evaluate(async () => {
    const response = await fetch("/api/data/funnel");
    return response.json();
  });
  const changes = payload.meta.changes;
  await page.getByRole("button", { name: "More" }).click();
  await expect(page.locator(".menu-note").filter({ hasText: "previous published build" })).toHaveText(
    `Since the previous published build: ${changes.new_sites} new sites, ${changes.verdict_changes} verdict changes, ${changes.stage_moves} stage moves.`,
  );
});

test("a site card does not show utility rows", async ({ page }) => {
  await signIn(page);
  await page.goto("/?site=PHX-U180");
  await expect(page.locator("aside.drawer")).toContainText("PHX-U180");
  await expect(page.locator("aside.drawer")).not.toContainText("Utility proximity");
  await expect(page.locator("aside.drawer")).not.toContainText("Serving utility");
});

test("a filtered funnel badge matches the pins", async ({ page }) => {
  await signIn(page);
  await page.goto("/?stage=land&tier=L4");
  const strong = page.locator(".funnel .step button.on strong");
  await expect(strong).toContainText("of");
  const visible = await page.locator(".shell").getAttribute("data-visible");
  const count = await strong.getAttribute("data-count");
  expect(count).toBe(visible);
});

test("dropped reasons are not wrapped twice", async ({ page }) => {
  await signIn(page);
  await page.goto("/?funnel=pipeline&pstage=dropped&site=PIPE-LAS-0016");
  const drawer = page.locator("aside.drawer");
  await expect(drawer).toBeVisible();
  const text = await drawer.innerText();
  expect(text).not.toContain("((");
});
