import { expect, test } from "@playwright/test";

test("a universe card embeds street view and can switch to the aerial", async ({ page }, info) => {
  const phone = info.project.name === "mobile";
  if (phone) await page.setViewportSize({ width: 374, height: 800 });
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
  const frame = page.getByTestId("street-view-frame");
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute("src", /output=svembed/);
  await expect(frame).toHaveAttribute("src", /layer=c/);
  await expect(page.getByRole("tab", { name: "Street View" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Aerial" })).toBeVisible();
  await expect(page.getByTestId("street-view-link")).toHaveCount(0);
  await expect(page.getByText("No street view or photos on file")).toHaveCount(0);
  const heroFit = await frame.evaluate((node) => {
    const hero = node.closest(".hero-frame");
    const drawer = node.closest(".drawer");
    if (!hero || !drawer) return null;
    const box = node.getBoundingClientRect();
    const frameBox = hero.getBoundingClientRect();
    const drawerBox = drawer.getBoundingClientRect();
    return {
      height: box.height,
      width: frameBox.width,
      covers: box.width >= frameBox.width - 1 && box.height >= frameBox.height - 1,
      wide: frameBox.width >= drawerBox.width - 2,
    };
  });
  expect(heroFit?.covers).toBe(true);
  expect(heroFit?.wide).toBe(true);
  expect(heroFit?.height ?? 0).toBeGreaterThan(phone ? 250 : 170);
  expect(heroFit?.height ?? 0).toBeLessThan(phone ? 320 : 200);
  if (phone) {
    const ratio = (heroFit?.width ?? 0) / (heroFit?.height || 1);
    expect(ratio).toBeGreaterThan(1.28);
    expect(ratio).toBeLessThan(1.4);
  }
  await page.getByRole("tab", { name: "Aerial" }).click();
  await expect(frame).toHaveCount(0);
  const aerial = page.getByTestId("aerial-thumb");
  await expect(aerial).toBeVisible();
  await expect(aerial).toHaveAttribute("src", /World_Imagery\/MapServer\/export\?/);
  const aerialFit = await aerial.evaluate((node) => {
    const hero = node.closest(".hero-frame");
    if (!hero) return null;
    const box = node.getBoundingClientRect();
    const frameBox = hero.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      covers: box.width >= frameBox.width - 1 && box.height >= frameBox.height - 1,
      fit: style.objectFit,
      position: style.objectPosition,
    };
  });
  expect(aerialFit?.covers).toBe(true);
  expect(aerialFit?.fit).toBe("cover");
  expect(aerialFit?.position === "center" || aerialFit?.position === "50% 50%").toBe(true);
  await page.getByRole("tab", { name: "Street View" }).click();
  await expect(page.getByTestId("street-view-frame")).toBeVisible();
  if (!found.photo) return;
  await page.goto(`/?funnel=universe&site=${found.photo}`, { waitUntil: "domcontentloaded" });
  const photos = page.getByRole("tab", { name: /^Photos/ });
  if (await photos.count()) await expect(photos).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Street View" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Aerial" })).toBeVisible();
  await expect(page.locator(".aerial-thumb")).toHaveCount(0);
});
