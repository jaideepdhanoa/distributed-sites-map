import { expect, test } from "@playwright/test";

test("original listing is readable in the property sources, including when none is on file", async ({ page }) => {
  await page.goto("/?funnel=pipeline&view=list&site=PIPE-PHX-0001");
  await page.locator("aside.drawer").getByText("Property, contacts and sources",{exact:true}).click();
  const link = page.getByTestId("listing-link");
  await expect(link).toBeVisible();
  await expect(link).toHaveAccessibleName("Listing ↗");
  await expect(link).toHaveAttribute("target", "_blank");

  await page.goto("/?funnel=pipeline&view=list&site=PIPE-LAS-0011");
  await page.locator("aside.drawer").getByText("Property, contacts and sources",{exact:true}).click();
  await expect(page.getByTestId("listing-link")).toHaveText("No listing on file");
  await expect(page.getByTestId("listing-link")).not.toHaveAttribute("href", /.+/);

  await page.goto("/?funnel=pipeline&view=list&site=PIPE-LAS-0072");
  await page.locator("aside.drawer").getByText("Property, contacts and sources",{exact:true}).click();
  await expect(page.getByTestId("listing-link")).toHaveAccessibleName("Listing ↗");
  await expect(page.getByTestId("listing-link")).toHaveAttribute("title", "May be removed");
});

test("a deal with a site folder shows it next to the map and listing links", async ({ page }) => {
  await page.goto("/?funnel=pipeline&view=list&site=PIPE-MIA-0080");
  await page.locator("aside.drawer").getByText("Property, contacts and sources",{exact:true}).click();
  const folder = page.getByTestId("site-folder-link");
  await expect(folder).toBeVisible();
  await expect(folder).toHaveAccessibleName("Site folder ↗");
  await expect(folder).toHaveAttribute("href", "https://drive.google.com/drive/folders/1xv4HiB8wZ7MVatRBfquRLScog4nByhqQ");
  await expect(folder).toHaveAttribute("target", "_blank");
  await expect(page.getByTestId("map-link")).toHaveText("Map ↗");
  await expect(page.getByTestId("street-view-link")).toHaveText("Street View ↗");
  await expect(page.getByTestId("listing-link")).toHaveAccessibleName("Listing ↗");
  await expect(page.getByTestId("overview-cash")).toBeVisible();
  await expect(page.getByTestId("card-numbers")).toContainText("vehicles/day");
  await page.getByRole("tab", {name:"Diligence",exact:true}).click();
  const step = page.getByTestId("workbook-step");
  await expect(step).toBeVisible();
  await expect(step).not.toContainText(/\b[RT]-\d{2,4}\b/);
  const more = step.getByRole("button", { name: "Show full note" });
  if (await more.count()) await more.click();
  await expect(step).toContainText("POS/car counts");
  await expect(page.locator("aside.drawer")).not.toContainText("Broker contacted");
  await expect(page.locator("aside.drawer")).not.toContainText("Not a fit");
  await expect(page.locator("aside.drawer")).not.toContainText("Not required");
  if ((page.viewportSize()?.width ?? 1440) < 768 && !page.url().includes("sheet=")) {
    const opened = new URL(page.url());
    opened.searchParams.set("sheet", "full");
    await page.goto(opened.toString());
  }
  await page.getByTestId("panel-tab-numbers").click();
  const figures = page.getByTestId("key-strip");
  await expect(figures).toBeVisible();
  await expect(figures).toContainText("Open land");
  await expect(figures).toContainText("Earlier stall estimate");
  await expect(figures).toContainText("Space");
  await expect(figures).toContainText("Power");
  await expect(figures).toContainText("Supporting market and financial figures");
  if ((page.viewportSize()?.width ?? 1440) < 768) {
    const next = new URL(page.url());
    next.searchParams.set("sheet", "half");
    await page.goto(next.toString());
  }
  const imagery = page.locator("details.record-imagery");
  await expect(imagery).not.toHaveAttribute("open", "");
  await imagery.locator("summary").click();
  const photos = page.getByTestId("site-photos");
  await expect(photos).toBeVisible();
  const thumb = page.getByTestId("photo-thumb").first();
  await expect(thumb).toBeVisible();
  await expect(thumb.locator("img")).toHaveAttribute("src", /^\/api\/data\/photos\/[a-f0-9]{20}\.jpg$/);


  const narrow = (page.viewportSize()?.width ?? 1440) < 768;
  await page.goto(`/?view=list&site=MIA-U747${narrow ? "&sheet=half" : ""}`);
  await page.locator("aside.drawer").getByText("Property, contacts and sources",{exact:true}).click();
  const siteFolder = page.getByTestId("site-folder-link");
  await expect(siteFolder).toBeVisible();
  await expect(siteFolder).toHaveAttribute("href", "https://drive.google.com/drive/folders/1xv4HiB8wZ7MVatRBfquRLScog4nByhqQ");
  await page.getByRole("tab", {name:"Site fit",exact:true}).click();
  await expect(imagery).not.toHaveAttribute("open", "");
  await imagery.locator("summary").click();
  await expect(page.getByTestId("site-photos")).toBeVisible();
});
