import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const password = process.env.E2E_PASSWORD || "e2e-pass-actions";
const site = "PHX-U189";
const shots = "/opt/cursor/artifacts";

async function openAs(page: Page, path: string) {
  await page.goto("/login");
  await page.getByLabel("Username").fill("contributor");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.goto(path);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}

async function markSample(page: Page) {
  return page.evaluate(async (siteId) => {
    const response = await fetch("/api/changes", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({
        changes: [{
          entity_type: "site_space",
          site_id: siteId,
          expected_version: 0,
          source: "Site aerial",
          payload: {
            center_lng: -112.070527,
            center_lat: 33.407157,
            length_ft: 90,
            width_ft: 60,
            rotation_deg: 12,
            type: "excess_parking",
            layout: "stalls_90",
          },
        }],
      }),
    });
    const body = await response.json() as { error?: string; results?: { entity_id?: string }[] };
    return { status: response.status, id: body.results?.[0]?.entity_id || "", error: body.error || "" };
  }, site);
}

async function snap(page: Page, target: string, file: string) {
  const layers = page.getByRole("button", { name: "Close layers" });
  if (await layers.isVisible().catch(() => false)) await layers.click();
  await page.locator(target).scrollIntoViewIfNeeded();
  await page.screenshot({ path: file, animations: "disabled" });
}

test.beforeAll(() => {
  mkdirSync(shots, { recursive: true });
});

test("desktop mark, measure, and comment on a space", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAs(page, `/?funnel=universe&site=${site}`);
  await expect(page.locator("aside.drawer")).toBeVisible();
  const seeded = await markSample(page);
  expect(seeded.status, seeded.error).toBe(200);
  await page.goto(`/?funnel=universe&site=${site}&space=${seeded.id}`);
  await expect(page.getByTestId("spaces-tab")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".space-stage canvas")).toBeVisible();
  await expect(page.getByTestId("space-measure")).toContainText("90 ft × 60 ft");
  await expect(page.getByTestId("space-estimate")).toHaveText("Estimated · 20 stalls");
  await expect(page.getByTestId("space-caution")).toContainText("Estimated");

  await page.getByTestId("mark-space").click();
  const map = page.getByTestId("space-aerial");
  await snap(page, "[data-testid='space-aerial']", `${shots}/space-desktop-aerial-ready.png`);
  const box = await map.boundingBox();
  if (!box) throw new Error("aerial has no box");
  await page.mouse.move(box.x + 48, box.y + 72);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 36, box.y + box.height - 64, { steps: 16 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${shots}/space-desktop-draw.png`, animations: "disabled" });
  await page.mouse.up();
  await expect(page.getByTestId("space-thread")).toBeVisible();
  await snap(page, "[data-testid='space-panel']", `${shots}/space-desktop-selected.png`);

  const before = await page.getByTestId("space-estimate").innerText();
  await page.getByTestId("space-layout").selectOption("pull_through");
  await expect(page.getByTestId("space-estimate")).not.toHaveText(before);
  await expect(page.getByTestId("space-estimate")).toContainText("Estimated");
  await expect(page.getByTestId("space-estimate")).toContainText(/bay/);

  const thread = page.getByTestId("space-thread");
  await thread.getByTestId("space-note-body").fill("Please look at the east row. @Rev");
  await page.getByRole("option", { name: "Reviewer" }).click();
  await expect(thread.getByTestId("mention-chip")).toContainText("Reviewer");
  await thread.getByRole("button", { name: "Comment" }).click();
  await expect(thread.getByTestId("space-note")).toContainText("east row");
  await snap(page, "[data-testid='space-thread']", `${shots}/space-desktop-comment.png`);
});

test("phone can view a space and comment", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openAs(page, `/?funnel=universe&site=${site}`);
  const seeded = await markSample(page);
  expect(seeded.status, seeded.error).toBe(200);
  await page.goto(`/?funnel=universe&site=${site}&space=${seeded.id}`);
  const grab = page.getByRole("button", { name: "Drag sheet" });
  await grab.click();
  await grab.focus();
  await page.keyboard.press("ArrowUp");
  const panel = page.getByTestId("space-panel");
  await panel.scrollIntoViewIfNeeded();
  await expect(panel.getByTestId("space-measure")).toContainText("90 ft × 60 ft");
  await expect(panel.getByTestId("space-estimate")).toHaveText("Estimated · 20 stalls");
  await expect(panel.getByTestId("space-layout")).toBeVisible();
  await snap(page, "[data-testid='space-aerial']", `${shots}/space-phone-selected.png`);

  const thread = panel.getByTestId("space-thread");
  await thread.getByTestId("space-note-body").fill("The row looks usable from the aerial.");
  await thread.getByRole("button", { name: "Comment" }).click();
  await expect(thread.getByTestId("space-note")).toContainText("usable from the aerial");
  await snap(page, "[data-testid='space-thread']", `${shots}/space-phone-comment.png`);
});
