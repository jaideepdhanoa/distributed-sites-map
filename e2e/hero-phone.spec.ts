import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

const widths = [360, 390] as const;

async function heroLayout(page: Page) {
  return page.locator("aside.drawer .hero-slot").evaluate((slot) => {
    const frameNode = slot.querySelector(".hero-frame");
    const tabNode = slot.querySelector(".hero-tabs");
    if (!frameNode || !tabNode) return null;
    const frame = frameNode.getBoundingClientRect();
    const tabs = tabNode.getBoundingClientRect();
    const buttons = [...slot.querySelectorAll(".hero-expand, .hero-info")].map((node) => {
      const box = node.getBoundingClientRect();
      return { right: box.right, bottom: box.bottom, top: box.top, left: box.left, width: box.width, height: box.height };
    });
    const labels = [...tabNode.querySelectorAll("button")].map((node) => {
      const box = node.getBoundingClientRect();
      return {
        label: (node.textContent || "").replace(/\s+/g, " ").trim(),
        clipped: node.scrollWidth > node.clientWidth + 1,
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
      };
    });
    const paint = getComputedStyle(tabNode);
    const scroller = slot.closest(".drawer-scroll");
    const scroll = scroller ? getComputedStyle(scroller) : null;
    const hits = (left: number, right: number, top: number, bottom: number, other: { left: number; right: number; top: number; bottom: number }) =>
      right > other.left + 1 && left < other.right - 1 && bottom > other.top + 1 && top < other.bottom - 1;
    return {
      width: frame.width,
      height: frame.height,
      ratio: frame.width / frame.height,
      tabsInside: tabs.left >= frame.left - 1 && tabs.right <= frame.right + 1 && tabs.top >= frame.top - 1 && tabs.bottom <= frame.bottom + 1,
      tabsLeft: tabs.left - frame.left,
      tabsBottomGap: frame.bottom - tabs.bottom,
      labels,
      tabHeight: tabs.height,
      pillsInside: labels.every((pill) => pill.left >= tabs.left - 1 && pill.right <= tabs.right + 1),
      hitsTabs: buttons.some((button) => labels.some((pill) => hits(button.left, button.right, button.top, button.bottom, pill))),
      buttonBottomGap: buttons.length ? Math.min(...buttons.map((button) => frame.bottom - button.bottom)) : null,
      buttonRightGap: buttons.length ? Math.min(...buttons.map((button) => frame.right - button.right)) : null,
      buttonHeight: buttons.length ? Math.min(...buttons.map((button) => button.height)) : null,
      blur: paint.backdropFilter || "",
      background: paint.backgroundColor,
      scrollable: scroll ? scroll.overflowY === "auto" || scroll.overflowY === "scroll" : false,
      overflows: scroller ? scroller.scrollHeight > scroller.clientHeight + 8 : false,
    };
  });
}

test("phone hero overlays the view toggles on a 4:3 frame", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phone hero");
  fs.mkdirSync("review-shots", { recursive: true });
  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/?funnel=pipeline&site=PIPE-MIA-0080&sheet=full", { waitUntil: "domcontentloaded" });
    const scroller = page.locator(".drawer-scroll");
    await scroller.evaluate((node) => { node.scrollTop = 0; });
    await expect(page.getByRole("tab", { name: "Street View" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Aerial" })).toBeVisible();
    await expect(page.getByRole("tab", { name: /^Photos/ })).toBeVisible();
    await page.getByRole("tab", { name: "Street View" }).click();
    await expect(page.getByTestId("street-view-frame")).toBeVisible();
    await expect(page.getByTestId("hero-expand")).toBeVisible();
    const hero = await heroLayout(page);
    expect(hero, `hero at ${width}`).not.toBeNull();
    expect(hero?.ratio ?? 0).toBeGreaterThan(1.28);
    expect(hero?.ratio ?? 0).toBeLessThan(1.4);
    expect(hero?.height ?? 0).toBeGreaterThan(width === 360 ? 250 : 275);
    expect(hero?.height ?? 0).toBeLessThan(width === 360 ? 290 : 320);
    expect(hero?.tabsInside).toBe(true);
    expect(hero?.tabsLeft ?? 99).toBeGreaterThanOrEqual(4);
    expect(hero?.tabsLeft ?? 99).toBeLessThanOrEqual(16);
    expect(hero?.tabsBottomGap ?? 0).toBeGreaterThanOrEqual(16);
    expect(hero?.tabsBottomGap ?? 99).toBeLessThanOrEqual(32);
    expect(hero?.tabHeight ?? 99).toBeLessThan(40);
    expect(hero?.labels.every((item) => item.label && !item.clipped)).toBe(true);
    expect(hero?.pillsInside).toBe(true);
    expect(hero?.hitsTabs).toBe(false);
    expect(hero?.buttonBottomGap ?? 0).toBeGreaterThanOrEqual(16);
    expect(hero?.buttonRightGap ?? 0).toBeGreaterThanOrEqual(52);
    expect(hero?.buttonHeight ?? 0).toBeGreaterThanOrEqual(44);
    expect(hero?.blur ?? "").toContain("blur");
    expect(hero?.background ?? "").toMatch(/rgba\([^)]+,\s*0\.\d+/);
    const street = page.getByTestId("street-view-frame");
    await expect(street).toBeVisible();
    const covered = await street.evaluate((node) => {
      const hero = node.closest(".hero-frame");
      if (!hero) return false;
      const box = node.getBoundingClientRect();
      const frame = hero.getBoundingClientRect();
      return box.width >= frame.width - 1 && box.height >= frame.height - 1;
    });
    expect(covered).toBe(true);
    expect(hero?.scrollable).toBe(true);
    expect(hero?.overflows).toBe(true);
    await page.locator("aside.drawer .hero-slot").screenshot({ path: `review-shots/phone-hero-${width}.png` });
    await page.getByRole("tab", { name: "Aerial" }).click();
    const aerial = page.getByTestId("aerial-thumb");
    await expect(aerial).toBeVisible();
    const fit = await aerial.evaluate((node) => getComputedStyle(node).objectFit);
    expect(fit).toBe("cover");
    const aerialHero = await heroLayout(page);
    expect(aerialHero?.tabsInside).toBe(true);
    expect(aerialHero?.hitsTabs).toBe(false);
    await page.getByRole("tab", { name: /^Photos/ }).click();
    const still = page.locator(".hero-still");
    await expect(still).toBeVisible();
    const photoFit = await still.evaluate((node) => {
      const image = node.querySelector("img");
      return {
        frame: getComputedStyle(node).objectFit,
        image: image ? getComputedStyle(image).objectFit : "cover",
      };
    });
    expect(photoFit.frame).toBe("cover");
    expect(photoFit.image).toBe("cover");
  }
});
