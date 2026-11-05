import { expect, test } from "@playwright/test";

const panels = [
  { id: "PIPE-PHX-0067", stage: "desk", city: "", exact: "$4,990,000" },
  { id: "PIPE-LAS-0016", stage: "dropped", city: "city=LAS&", exact: "$7,000,000" },
];
const widths = [1024, 1440, 390];

for (const panel of panels) {
  for (const width of widths) {
    test(`key tiles fit ${panel.id} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
      await page.goto(`/?${panel.city}funnel=pipeline&pstage=${panel.stage}&site=${panel.id}`);
      await page.waitForSelector("[data-testid=key-strip] strong");
      const strip = page.getByTestId("key-strip");
      await expect(strip).toContainText(panel.exact === "$7,000,000" ? "$7M" : "$4.99M");
      const overview = page.locator(".drawer .kv");
      await expect(overview).toContainText(panel.exact);
      const offenders = await strip.locator("strong").evaluateAll((nodes) =>
        nodes.flatMap((node) => {
          const el = node as HTMLElement;
          const overflow = el.scrollWidth - el.clientWidth;
          return overflow > 1 ? [`${(el.textContent || "").trim()} overflows by ${overflow}`] : [];
        }),
      );
      expect(offenders).toEqual([]);
    });
  }
}
