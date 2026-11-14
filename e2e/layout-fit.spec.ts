import { expect, test } from "@playwright/test";

test("the phone funnel keeps the service-area split off the listed line", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phone funnel");
  await page.goto("/?funnel=universe&reach=within5", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".shell");
  await page.locator("button.phone-step").click();
  await expect(page.getByTestId("service-area-split")).toBeVisible();
  const problem = await page.evaluate(() => {
    const step = [...document.querySelectorAll(".funnel .step")].find((el) => /Service area/.test(el.textContent || ""));
    const split = step?.querySelector("[data-testid=service-area-split]");
    const listed = [...(step?.querySelectorAll(".sub") || [])].find((el) => /listed/.test(el.textContent || ""));
    const row = document.querySelector(".funnel-row");
    const close = row?.querySelector(".close");
    const first = row?.querySelector(".funnel .step");
    if (!step || !split || !listed || !row || !close || !first) return "missing funnel pieces";
    const splitBox = split.getBoundingClientRect();
    const listedBox = listed.getBoundingClientRect();
    const overlap = Math.min(splitBox.bottom, listedBox.bottom) - Math.max(splitBox.top, listedBox.top);
    if (overlap > 1) return `split covers listed by ${Math.round(overlap)}px`;
    if (listedBox.top < splitBox.bottom + 2) return `listed is ${Math.round(listedBox.top - splitBox.bottom)}px under the split`;
    const sheet = row.getBoundingClientRect();
    const firstBox = first.getBoundingClientRect();
    const closeBox = close.getBoundingClientRect();
    if (firstBox.top - sheet.top > 16) return `funnel starts ${Math.round(firstBox.top - sheet.top)}px below the sheet`;
    if (closeBox.width > 48 || closeBox.height > 48) return `close is ${Math.round(closeBox.width)} by ${Math.round(closeBox.height)}`;
    const bar = document.querySelector(".bar");
    if (!bar) return "missing header";
    const paint = getComputedStyle(bar);
    if (paint.backgroundImage.includes("gradient")) return "header fades over the map";
    const ask = document.querySelector(".ask-launch");
    if (!ask) return "missing Ask";
    const askBox = ask.getBoundingClientRect();
    const overAsk = document.elementFromPoint(askBox.left + askBox.width / 2, askBox.top + askBox.height / 2);
    const atEdge = document.elementFromPoint(4, 24);
    const canvas = (node: Element | null) => Boolean(node?.closest(".maplibregl-map, canvas"));
    if (canvas(overAsk)) return "a map mark covers Ask";
    if (canvas(atEdge)) return "a map mark shows through the header edge";
    return "";
  });
  expect(problem).toBe("");
});

test("the desk list keeps the location note out of the stage tabs", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop list");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?funnel=pipeline&pstage=desk&view=list", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid=pipeline-list]");
  await expect(page.locator("nav.funnel").getByText("without a location")).toHaveCount(0);
  const note = page.getByTestId("unmapped-note");
  if (await note.count()) {
    await expect(note).toBeVisible();
    await expect(note).toContainText("without a location");
  }
  const mark = page.locator("[data-testid=pipeline-list] [data-testid=suggested-drop]").first();
  await expect(mark).toBeVisible();
  await expect(mark).toHaveText(/^Suggested drop: /);
  const lines = await mark.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getClientRects().length;
  });
  expect(lines).toBe(1);
});
