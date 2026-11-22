import { expect, test } from "@playwright/test";

test("a universe card shows an aerial tile and a street view link", async ({ page }) => {
  await page.goto("/?funnel=universe&city=LAS", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".shell");
  const id = await page.evaluate(async () => {
    const response = await fetch("/api/data/sites?city=LAS");
    const body = await response.json() as { features?: { geometry?: { coordinates?: number[] } | null; properties?: { site_id?: string } }[] };
    const feature = (body.features || []).find((item) => item.geometry?.coordinates && String(item.properties?.site_id || "").startsWith("WB-"));
    return feature?.properties?.site_id || "";
  });
  expect(id).toMatch(/^WB-/);
  await page.goto(`/?funnel=universe&site=${id}`, { waitUntil: "domcontentloaded" });
  const thumb = page.getByTestId("aerial-thumb");
  await expect(thumb).toBeVisible();
  await expect(thumb.locator("img")).toHaveAttribute("src", /server\.arcgisonline\.com\/ArcGIS\/rest\/services\/World_Imagery\/MapServer\/tile\//);
  const link = page.getByTestId("street-view-link");
  await expect(link).toHaveAttribute("href", /google\.com\/maps\/@\?api=1&map_action=pano&viewpoint=/);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(page.locator("[data-testid=street-view-frame]")).toHaveCount(0);
});
