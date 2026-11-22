import { expect, test } from "@playwright/test";

test("the NDA queue is a table on desktop and cards on a phone", async ({ page }, info) => {
  await page.goto("/?nda=1", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("nda-queue")).toBeVisible();
  await expect(page.getByTestId("nda-export")).toBeVisible();
  if (info.project.name === "mobile") {
    await expect(page.getByTestId("nda-cards")).toBeVisible();
    await page.getByTestId("nda-cards").locator("button").first().click();
  } else {
    await expect(page.getByRole("button", { name: "NDA id" })).toBeVisible();
    const cell = page.getByRole("gridcell").filter({ hasText: /^NDA-/ }).first();
    await expect(cell).toBeVisible();
    await cell.click();
  }
  await expect(page.getByTestId("nda-detail")).toBeVisible();
  await expect(page.getByTestId("nda-history")).toContainText("On the register");
  await page.getByTestId("nda-draft").click();
  const draft = await page.getByTestId("nda-draft-text").inputValue();
  expect(draft.toLowerCase()).not.toContain("charging");
  expect(draft).not.toMatch(/\bAVs?\b/i);
  await expect(page.getByRole("button", { name: "Copy draft" })).toBeVisible();
});
