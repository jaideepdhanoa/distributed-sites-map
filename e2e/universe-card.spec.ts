import { expect, test } from "@playwright/test";

test("a universe card shows an aerial that fills its frame and one street view link", async ({ page }, info) => {
  if (info.project.name === "mobile") await page.setViewportSize({ width: 374, height: 800 });
  await page.goto("/?funnel=universe&city=LAS", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".shell");
  const found = await page.evaluate(async () => {
    async function sites(city: string) {
      const response = await fetch(`/api/data/sites?city=${city}`);
      const body = await response.json() as { features?: { geometry?: { coordinates?: number[] } | null; properties?: { site_id?: string; photos?: unknown[] } }[] };
      return body.features || [];
    }
    const [las, phx] = await Promise.all([sites("LAS"), sites("PHX")]);
    const idOf = (item: { geometry?: { coordinates?: number[] } | null; properties?: { site_id?: string; photos?: unknown[] } }) => {
      const id = String(item.properties?.site_id || "");
      return item.geometry?.coordinates && id.startsWith("WB-") ? id : "";
    };
    const bare = [...las, ...phx].find((item) => idOf(item) && !(Array.isArray(item.properties?.photos) && item.properties.photos.length > 0));
    const plain = (bare && idOf(bare)) || las.map(idOf).find(Boolean) || phx.map(idOf).find(Boolean) || "";
    const photo = phx.find((item) => idOf(item) && Array.isArray(item.properties?.photos) && item.properties.photos.length > 0);
    return { plain, photo: photo ? idOf(photo) : "" };
  });
  expect(found.plain).toMatch(/^WB-/);
  await page.goto(`/?funnel=universe&site=${found.plain}`, { waitUntil: "domcontentloaded" });
  const thumb = page.getByTestId("aerial-thumb");
  await expect(thumb).toBeVisible();
  await expect(thumb.locator("img")).toHaveAttribute("src", /World_Imagery\/MapServer\/export\?/);
  const fit = await thumb.evaluate((node) => {
    const image = node.querySelector("img");
    const card = node.closest(".drawer-scroll");
    if (!image || !card) return null;
    const frame = node.getBoundingClientRect();
    const box = image.getBoundingClientRect();
    const cardStyle = getComputedStyle(card);
    const content = card.clientWidth - parseFloat(cardStyle.paddingLeft) - parseFloat(cardStyle.paddingRight);
    return {
      covers: box.width >= frame.width - 1 && box.height >= frame.height - 1,
      full: Math.abs(frame.width - content) <= 2,
      ratio: frame.width / frame.height,
      fit: getComputedStyle(image).objectFit,
      position: getComputedStyle(image).objectPosition,
    };
  });
  expect(fit?.covers).toBe(true);
  expect(fit?.ratio ?? 0).toBeGreaterThan(1.9);
  expect(fit?.ratio ?? 0).toBeLessThan(2.1);
  expect(fit?.fit).toBe("cover");
  expect(fit?.position === "center" || fit?.position === "50% 50%").toBe(true);
  await expect(page.getByRole("link", { name: "Open Street View" })).toHaveCount(1);
  const link = page.getByTestId("street-view-link");
  await expect(link).toHaveAttribute("href", /google\.com\/maps\/@\?api=1&map_action=pano&viewpoint=/);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(page.locator("[data-testid=street-view-frame]")).toHaveCount(0);
  await expect(page.getByText("No street view or photos on file")).toHaveCount(0);
  if ((await thumb.getAttribute("data-compact")) === "0") {
    expect(fit?.full).toBe(true);
    await expect(page.getByTestId("photo-empty")).toHaveText("Aerial only — no site photos yet");
  }
  if (!found.photo) return;
  await page.goto(`/?funnel=universe&site=${found.photo}`, { waitUntil: "domcontentloaded" });
  const compact = page.getByTestId("aerial-thumb");
  await expect(compact).toHaveAttribute("data-compact", "1");
  const smaller = await page.evaluate(() => {
    const aerial = document.querySelector("[data-testid=aerial-thumb]")?.getBoundingClientRect();
    const hero = document.querySelector(".hero-frame")?.getBoundingClientRect();
    if (!aerial || !hero) return false;
    return aerial.width < hero.width && aerial.height < hero.height;
  });
  expect(smaller).toBe(true);
  await expect(page.getByRole("link", { name: "Open Street View" })).toHaveCount(1);
});
