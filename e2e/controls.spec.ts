import { expect, test, type Page } from "@playwright/test";

async function nativeControls(page: Page) {
  return page.evaluate(() => {
    const bad: { tag: string; text: string; appearance: string; background: string; accent: string; className: string }[] = [];
    for (const el of document.querySelectorAll("button, select, input[type=checkbox]")) {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2 || style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
      const appearance = style.appearance;
      const background = style.backgroundColor;
      const accent = style.accentColor;
      const className = typeof el.className === "string" ? el.className : "";
      const gray = background === "rgb(239, 239, 239)" || background === "rgb(240, 240, 240)";
      if (appearance === "auto" || gray || (accent === "auto" && !className.trim())) {
        bad.push({
          tag: el.tagName,
          text: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 60),
          appearance,
          background,
          accent,
          className,
        });
      }
    }
    return bad;
  });
}

test("phone list, columns, compare, and layers are not browser controls", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "covered at 390px");
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/?funnel=pipeline&city=LAS&pstage=desk&view=list");
  await expect(page.getByTestId("pipeline-list")).toBeVisible();
  await expect(page.getByRole("button", { name: "Columns" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Filters" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Sort" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show on map" }).first()).toBeVisible();
  expect(await nativeControls(page)).toEqual([]);

  await page.locator(".list-cards button.list-row").first().click();
  await expect(page.getByRole("button", { name: /compare/i })).toBeVisible();
  expect(await nativeControls(page)).toEqual([]);

  await page.goto("/?funnel=pipeline&city=LAS&pstage=desk");
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await expect(page.getByTestId("basemap")).toBeVisible();
  const measure = await page.getByTestId("measure").boundingBox();
  expect(measure && measure.x >= 0 && measure.x + measure.width <= 390).toBeTruthy();
  expect(await nativeControls(page)).toEqual([]);
});
