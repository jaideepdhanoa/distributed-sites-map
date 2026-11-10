import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

const note = {
  id: "note-1",
  parentId: null,
  body: "The frontage needs another look.",
  authorId: "cindel",
  createdAt: "2026-11-01T18:00:00.000Z",
  updatedAt: null,
  deleted: false,
  resolvedAt: null,
  mentions: [],
};

const recommendation = {
  id: "rec-1",
  kind: "reply",
  draftText: "The driveway is the tight part.",
  decision: "none",
  rationale: "It answers the note about the frontage.",
  sources: [{ label: "Discussion", url: "/?site=PHX-U189&panel=discussion", ref: null }],
  confidence: "medium",
  threadKey: "note:note-1",
  proposalId: null,
  siteId: "PHX-U189",
  siteUrl: "/?site=PHX-U189&panel=discussion",
};

async function installFeed(page: Page) {
  await page.route("**/api/actions/status", (route) => route.fulfill({ json: { enabled: true, actionRole: "reviewer", username: "jaideep" } }));
  await page.route("**/api/actions/notes**", (route) => route.fulfill({ json: { notes: [note] } }));
  await page.route("**/api/actions/suggestions**", (route) => route.fulfill({ json: { suggestions: [] } }));
  await page.route("**/api/actions/accounts", (route) => route.fulfill({ json: { accounts: [{ id: "cindel", name: "Cindel" }] } }));
  await page.route("**/api/actions/recommendations**", (route) => route.fulfill({ json: { recommendations: [recommendation] } }));
}

test.beforeAll(() => {
  fs.mkdirSync("review-shots", { recursive: true });
});

test("suggested block and ask panel", async ({ page }, info) => {
  const name = info.project.name;
  let posted = false;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/actions/notes")) posted = true;
  });
  await installFeed(page);
  await page.route("**/api/ask/status", (route) => route.fulfill({ json: { ready: true } }));
  await page.goto("/?site=PHX-U189&panel=discussion", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("aside.drawer");
  const block = page.getByTestId("suggested-block");
  await expect(block).toBeVisible();
  await expect(block).toContainText("The driveway is the tight part.");
  await expect(block).toContainText("medium confidence");
  await expect(block.getByTestId("suggested-site")).toHaveAttribute("href", "/?site=PHX-U189&panel=discussion");
  await block.screenshot({ path: `review-shots/${name}-suggested.png` });
  await page.getByTestId("suggested-use").click();
  await expect(page.getByTestId("note-reply")).toHaveValue("The driveway is the tight part.");
  expect(posted).toBe(false);

  await page.getByTestId("ask-open").click();
  const panel = page.getByTestId("ask-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("ask-chip")).toBeVisible();
  await panel.screenshot({ path: `review-shots/${name}-ask-site.png` });
  await page.getByTestId("ask-chip").click();
  await expect(page.getByTestId("ask-scope")).toContainText("Portfolio");
  await panel.screenshot({ path: `review-shots/${name}-ask-portfolio.png` });

  await page.getByRole("button", { name: "Close Ask" }).click();
  await page.route("**/api/ask/status", (route) => route.fulfill({ json: { ready: false } }));
  await page.getByTestId("ask-open").click();
  await expect(page.getByTestId("ask-unset")).toHaveText("Ask isn't set up yet");
  await page.getByTestId("ask-panel").screenshot({ path: `review-shots/${name}-ask-unset.png` });
});
