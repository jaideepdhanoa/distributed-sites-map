import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const password = process.env.E2E_PASSWORD || "e2e-pass-actions";
const site = "PHX-U180";
const deal = "PIPE-PHX-0008";

function blockedWord(): string {
  const file = JSON.parse(readFileSync("config/display-policy.json", "utf8")) as { words: string[] };
  const word = file.words
    .map((item) => Buffer.from(item, "base64").toString("utf8").replace(/^term:/, ""))
    .find((item) => item.length >= 6);
  if (!word) throw new Error("missing term");
  return word;
}

test.describe.configure({ mode: "serial" });

async function login(request: import("@playwright/test").APIRequestContext, username: string) {
  const response = await request.post("/api/login", { data: { username, password } });
  expect(response.ok()).toBeTruthy();
}

async function openAs(page: import("@playwright/test").Page, username: string, path: string) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.goto(path);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}

test("viewer is read only on the server and in the card", async ({ page, request }) => {
  await login(request, "viewer");
  const note = await request.post("/api/actions/notes", {
    data: { targetKind: "site", targetId: site, body: "A plain research note." },
  });
  expect(note.status()).toBe(403);
  const suggestion = await request.post("/api/actions/suggestions", {
    data: { targetKind: "deal", targetId: deal, field: "stage", proposedValue: "Dropped", reason: "Too small." },
  });
  expect(suggestion.status()).toBe(403);
  const decision = await request.post("/api/actions/suggestions/not-a-real-id", { data: { status: "accepted" } });
  expect(decision.status()).toBe(403);

  await openAs(page, "viewer", `/?site=${site}`);
  await expect(page.getByText("Notes are read only for this login.")).toBeVisible();
  await expect(page.getByTestId("suggest-change")).toHaveCount(0);
  await mkdir("/opt/cursor/artifacts", { recursive: true });
  await page.getByTestId("record-actions").screenshot({ path: "/opt/cursor/artifacts/actions-viewer-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  const more = page.getByRole("button", { name: "Show more" });
  if (await more.isVisible()) await more.click();
  await page.getByTestId("record-actions").screenshot({ path: "/opt/cursor/artifacts/actions-viewer-mobile.png" });
});

test("blocked wording is rejected and is not echoed", async ({ page, request }) => {
  await login(request, "contributor");
  const word = blockedWord();
  const response = await request.post("/api/actions/notes", {
    data: { targetKind: "site", targetId: site, body: `Please check ${word} before Friday.` },
  });
  expect(response.status()).toBe(400);
  const payload = (await response.json()) as { error?: string };
  expect(payload.error).toMatch(/not allowed on the map/);
  expect(JSON.stringify(payload).includes(word)).toBe(false);

  await openAs(page, "contributor", `/?site=${site}`);
  await expect(page.getByTestId("suggest-change")).toBeVisible();
  await mkdir("/opt/cursor/artifacts", { recursive: true });
  await page.getByTestId("record-actions").screenshot({ path: "/opt/cursor/artifacts/actions-contributor-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  const more = page.getByRole("button", { name: "Show more" });
  if (await more.isVisible()) await more.click();
  await page.getByTestId("record-actions").screenshot({ path: "/opt/cursor/artifacts/actions-contributor-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId("note-body").fill(`Please check ${word} before Friday.`);
  await page.getByRole("button", { name: "Save note" }).click();
  const alert = page.getByTestId("action-error");
  await expect(alert).toContainText("not allowed on the map");
  await expect(alert).not.toContainText(word);
  await alert.screenshot({ path: "/opt/cursor/artifacts/actions-banned-rejection.png" });
  await page.getByTestId("note-body").fill("");
});

test("a contributor can suggest a change and a reviewer can accept it without changing the deal", async ({ page, request }) => {
  await login(request, "contributor");
  const before = await request.get("/api/data/deals");
  const beforeStage = dealStage(await before.json(), deal);
  const created = await request.post("/api/actions/suggestions", {
    data: {
      targetKind: "deal",
      targetId: deal,
      field: "stage",
      proposedValue: "Dropped",
      reason: "The lot is smaller than the screen requires.",
    },
  });
  expect(created.status()).toBe(201);
  const suggestion = ((await created.json()) as { suggestion: { id: string; status: string } }).suggestion;
  expect(suggestion.status).toBe("open");

  await login(request, "reviewer");
  const accepted = await request.post(`/api/actions/suggestions/${suggestion.id}`, { data: { status: "accepted" } });
  expect(accepted.ok()).toBeTruthy();
  const after = await request.get("/api/data/deals");
  expect(dealStage(await after.json(), deal)).toBe(beforeStage);

  await openAs(page, "reviewer", `/?site=${deal}`);
  await expect(page.getByTestId("record-actions")).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Suggestions" }).click();
  await expect(page.getByTestId("suggestions-panel")).toBeVisible();
  await page.getByRole("button", { name: "accepted", exact: true }).click();
  await expect(page.getByTestId("suggestions-panel")).toContainText("Dropped");
  await page.getByTestId("suggestions-panel").screenshot({ path: "/opt/cursor/artifacts/actions-suggestions-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("suggestions-panel").screenshot({ path: "/opt/cursor/artifacts/actions-suggestions-mobile.png" });
});

test("a saved view round-trips the current link", async ({ request }) => {
  await login(request, "viewer");
  const saved = await request.post("/api/actions/views", {
    data: { name: "Phoenix spare land", query: "city=PHX&stage=land", scope: "personal" },
  });
  expect(saved.status()).toBe(201);
  const listed = await request.get("/api/actions/views");
  const views = ((await listed.json()) as { views: { name: string; query: string }[] }).views;
  expect(views.some((view) => view.name === "Phoenix spare land" && view.query === "city=PHX&stage=land")).toBe(true);
  const team = await request.post("/api/actions/views", { data: { name: "Team", query: "city=LAS", scope: "team" } });
  expect(team.status()).toBe(403);
});

function dealStage(payload: { features?: { properties?: { deal_id?: string; stage?: string } }[] }, id: string) {
  const feature = payload.features?.find((item) => item.properties?.deal_id === id);
  return feature?.properties?.stage ?? null;
}
