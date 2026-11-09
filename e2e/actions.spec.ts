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
  await page.getByTestId("panel-tab-discussion").click();
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
  await page.getByTestId("panel-tab-discussion").click();
  await expect(page.getByTestId("note-body")).toBeVisible();
  await expect(page.getByRole("button", { name: "Comment" })).toBeVisible();
  await mkdir("/opt/cursor/artifacts", { recursive: true });
  await page.getByTestId("record-actions").screenshot({ path: "/opt/cursor/artifacts/actions-contributor-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  const more = page.getByRole("button", { name: "Show more" });
  if (await more.isVisible()) await more.click();
  await page.getByTestId("record-actions").screenshot({ path: "/opt/cursor/artifacts/actions-contributor-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId("note-body").fill(`Please check ${word} before Friday.`);
  await page.getByRole("button", { name: "Comment" }).click();
  const alert = page.getByTestId("action-error");
  await expect(alert).toContainText("not allowed on the map");
  await expect(alert).not.toContainText(word);
  await alert.screenshot({ path: "/opt/cursor/artifacts/actions-banned-rejection.png" });
  await page.getByTestId("note-body").fill("");
});

test("a contributor can suggest a change and a reviewer can accept it without changing the deal", async ({ page, request }) => {
  await login(request, "contributor");
  const before = await request.get("/api/data/deals");
  expect(before.ok()).toBeTruthy();
  const catalog = (await before.json()) as { features?: { properties?: { deal_id?: string; stage?: string; kind?: string } }[] };
  const openDeal = (catalog.features || [])
    .map((item) => item.properties)
    .find((row) => row?.kind === "pipeline" && row.deal_id && row.stage && row.stage !== "Dropped");
  expect(openDeal?.deal_id, "a pipeline deal that is not already Dropped").toBeTruthy();
  const targetId = openDeal!.deal_id!;
  const beforeStage = openDeal!.stage!;
  const proposed = "Dropped";
  const created = await request.post("/api/actions/suggestions", {
    data: {
      targetKind: "deal",
      targetId,
      field: "stage",
      proposedValue: proposed,
      reason: "The lot is smaller than the screen requires.",
    },
  });
  expect(created.status()).toBe(201);
  const suggestion = ((await created.json()) as { suggestion: { id: string; status: string } }).suggestion;
  expect(suggestion.status).toBe("open");

  await login(request, "reviewer");
  const accepted = await request.post(`/api/actions/suggestions/${suggestion.id}`, { data: { status: "accepted" } });
  expect(accepted.ok()).toBeTruthy();
  const decision = (await accepted.json()) as { suggestion: { status: string } };
  expect(decision.suggestion.status).toBe("accepted");
  const after = await request.get("/api/data/deals");
  expect(dealStage(await after.json(), targetId)).toBe(beforeStage);

  await openAs(page, "reviewer", `/?site=${targetId}`);
  await page.getByTestId("panel-tab-discussion").click();
  await expect(page.getByTestId("record-actions")).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Suggestions" }).click();
  await expect(page.getByTestId("suggestions-panel")).toBeVisible();
  const panel = page.getByTestId("suggestions-panel");
  await page.getByRole("button", { name: "accepted", exact: true }).click();
  await expect(panel).toContainText(proposed);
  await expect(panel).toContainText(targetId);
  await expect(panel).not.toContainText("Nothing in this filter.");
  await page.getByTestId("suggestions-panel").screenshot({ path: "/opt/cursor/artifacts/actions-suggestions-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("suggestions-panel").screenshot({ path: "/opt/cursor/artifacts/actions-suggestions-mobile.png" });
});

test("a contributor can reply, and a non-reviewer cannot approve a next step", async ({ page, request }) => {
  await login(request, "contributor");
  const note = await request.post("/api/actions/notes", {
    data: { targetKind: "site", targetId: site, body: "The frontage needs another look." },
  });
  expect(note.status()).toBe(201);
  const root = ((await note.json()) as { note: { id: string } }).note;
  const reply = await request.post("/api/actions/notes", {
    data: { targetKind: "site", targetId: site, parentId: root.id, body: "The driveway is the tight part." },
  });
  expect(reply.status()).toBe(201);

  const proposal = await request.post("/api/actions/suggestions", {
    data: {
      targetKind: "site",
      targetId: site,
      field: "proposed_next_step",
      title: "Ask the broker for the sales package",
      targetOn: "2026-11-20",
      ownerId: "contributor",
    },
  });
  expect(proposal.status()).toBe(201);
  const created = ((await proposal.json()) as { suggestion: { id: string } }).suggestion;
  const denied = await request.post(`/api/actions/suggestions/${created.id}`, { data: { status: "accepted" } });
  expect(denied.status()).toBe(403);

  await openAs(page, "contributor", `/?site=${site}`);
  await page.getByTestId("panel-tab-discussion").click();
  await expect(page.getByTestId("note-threads")).toContainText("The driveway is the tight part.");
  await page.getByTestId("note-threads").screenshot({ path: "/opt/cursor/artifacts/actions-thread-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  const more = page.getByRole("button", { name: "Show more" });
  if (await more.isVisible()) await more.click();
  await page.getByTestId("note-threads").screenshot({ path: "/opt/cursor/artifacts/actions-thread-mobile.png" });
});

test("a reviewer approval shows the next step on the card", async ({ page, request }) => {
  await login(request, "contributor");
  const proposalResponse = await request.post("/api/actions/suggestions", {
    data: {
      targetKind: "site",
      targetId: site,
      field: "proposed_next_step",
      title: "Ask the broker for the sales package",
      targetOn: "2026-11-20",
      ownerId: "contributor",
    },
  });
  expect(proposalResponse.status()).toBe(201);
  const proposal = ((await proposalResponse.json()) as { suggestion: { id: string } }).suggestion;
  const before = await request.get("/api/data/deals");
  const beforeBody = await before.text();
  await login(request, "reviewer");
  const accepted = await request.post(`/api/actions/suggestions/${proposal.id}`, { data: { status: "accepted", note: "Approved." } });
  expect(accepted.ok()).toBeTruthy();
  const after = await request.get("/api/data/deals");
  expect(await after.text()).toBe(beforeBody);

  await openAs(page, "reviewer", `/?site=${site}`);
  await page.getByTestId("panel-tab-discussion").click();
  await page.setViewportSize({ width: 1440, height: 900 });
  const next = page.getByTestId("next-step");
  await expect(next).toContainText("Ask the broker for the sales package");
  await expect(next).toContainText("Nov 20");
  await next.screenshot({ path: "/opt/cursor/artifacts/actions-next-step-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  const more = page.getByRole("button", { name: "Show more" });
  if (await more.isVisible()) await more.click();
  await next.screenshot({ path: "/opt/cursor/artifacts/actions-next-step-mobile.png" });
});

test("discussion stays a comment box, and a reviewer can accept a knock off", async ({ page, request }) => {
  const target = "PIPE-PHX-0067";
  await login(request, "contributor");
  const before = await request.get("/api/data/deals");
  const beforeBody = await before.text();
  await openAs(page, "contributor", `/?funnel=pipeline&site=${target}`);
  await page.getByTestId("panel-tab-discussion").click();
  await expect(page.getByRole("checkbox", { name: "Propose next step" })).toHaveCount(0);
  await page.getByTestId("next-step").getByRole("button", { name: "Drop with a reason" }).click();
  await page.getByLabel("Reason").fill("The broker confirmed another buyer.");
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByTestId("proposed-next-step")).toContainText("Drop from pipeline");
  await expect(page.getByTestId("proposed-next-step")).toContainText("Waiting for");

  await openAs(page, "reviewer", `/?funnel=pipeline&site=${target}`);
  const card = page.getByTestId("proposed-next-step");
  await expect(card.getByRole("button", { name: "Accept" })).toBeVisible();
  await card.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByTestId("next-step")).toContainText("Drop from pipeline");
  await expect(page.getByTestId("next-step")).toContainText("Dropped");
  const after = await request.get("/api/data/deals");
  expect(await after.text()).toBe(beforeBody);
});

test("c-stores stay hidden until the filter is on, and review leads with approvals", async ({ page, request }) => {
  await mkdir("/opt/cursor/artifacts", { recursive: true });
  await openAs(page, "reviewer", "/?funnel=pipeline&pstage=desk&view=list");
  await expect(page.getByTestId("pipeline-list")).toBeVisible();
  await expect(page.getByTestId("pipeline-list")).not.toContainText("Sinclair");
  await page.getByRole("textbox", { name: "Search" }).first().fill("Sinclair");
  await expect(page.getByTestId("search-hits")).toBeVisible();
  await expect(page.getByTestId("search-hits")).not.toContainText("PIPE-PHX-0067");
  await page.getByRole("textbox", { name: "Search" }).first().fill("PIPE-MIA-0075");
  await expect(page.getByTestId("search-hits")).toContainText("PIPE-MIA-0075");
  await page.getByRole("textbox", { name: "Search" }).first().fill("");
  await page.waitForFunction(() => !location.search.includes("q="));
  await page.screenshot({ path: "/opt/cursor/artifacts/cstore-hidden-list.png" });
  await page.locator("button.tool", { hasText: "Filters" }).click();
  await page.getByTestId("cstore-toggle").click();
  await expect(page).toHaveURL(/cstore=1/);
  const sinclair = page.getByTestId("pipeline-list").getByText("Sinclair").first();
  await expect(sinclair).toBeVisible();
  await sinclair.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/opt/cursor/artifacts/cstore-shown-list.png" });
  await page.setViewportSize({ width: 390, height: 800 });
  const summary = await page.getByTestId("summary-row").boundingBox();
  const controls = await page.locator(".pipeline-list .list-bar").boundingBox();
  expect(summary && controls).toBeTruthy();
  if (summary && controls) expect(controls.y).toBeGreaterThanOrEqual(summary.y + summary.height - 1);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?funnel=pipeline&pstage=desk");
  await page.waitForSelector("[data-pin-count]");
  const pins = await page.locator(".shell").getAttribute("data-pin-count");
  await page.goto("/?funnel=pipeline&pstage=desk&cstore=1");
  await expect(page.locator(".shell")).toHaveAttribute("data-pin-count", pins || "");
  await page.waitForFunction(() => {
    const map = (window as unknown as { __sitesMap?: { isStyleLoaded: () => boolean; getSource: (id: string) => { serialize: () => { data?: { features?: unknown[] } } } } }).__sitesMap;
    if (!map?.isStyleLoaded()) return false;
    const data = map.getSource("deals")?.serialize()?.data;
    return Boolean(data && "features" in data && Array.isArray(data.features) && data.features.length >= 10);
  });

  await login(request, "contributor");
  const mention = await request.post("/api/actions/notes", {
    data: { targetKind: "deal", targetId: "PIPE-PHX-0008", body: "Please look at the frontage.", mentions: ["reviewer"] },
  });
  expect(mention.ok()).toBeTruthy();
  const approval = await request.post("/api/actions/suggestions", {
    data: {
      targetKind: "deal",
      targetId: "PIPE-LAS-0016",
      field: "proposed_next_step",
      title: "Confirm the spare land",
      targetOn: "2026-11-20",
      ownerId: "reviewer",
    },
  });
  expect(approval.ok()).toBeTruthy();

  await openAs(page, "reviewer", "/?review=1&qmarket=all&qviable=0");
  await expect(page.getByTestId("review-approvals")).toBeVisible();
  const firstCard = page.getByTestId("review-approvals").locator("button").first();
  await expect(firstCard).toContainText("Wash N Go");
  await page.setViewportSize({ width: 390, height: 800 });
  const searchBox = await page.getByRole("textbox", { name: "Search" }).locator("visible=true").first().boundingBox();
  const stageBox = await page.locator(".phone-step").boundingBox();
  const reviewBox = await page.getByTestId("review-bar").boundingBox();
  const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  expect(searchBox && stageBox && reviewBox).toBeTruthy();
  if (searchBox && reviewBox) expect(overlaps(searchBox, reviewBox)).toBe(false);
  if (stageBox && reviewBox) expect(overlaps(stageBox, reviewBox)).toBe(false);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: "/opt/cursor/artifacts/review-order.png" });

  await page.goto("/?funnel=pipeline&pstage=desk");
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Alerts" }).click();
  const settings = page.getByTestId("alert-settings");
  await expect(settings).toBeVisible();
  await expect(settings).toContainText("Approvals");
  await expect(settings).toContainText("Instant");
  await settings.screenshot({ path: "/opt/cursor/artifacts/alert-settings.png" });
});

test("the account menu stays above the review bar", async ({ page }) => {
  await openAs(page, "reviewer", "/?review=1&qmarket=all&qstage=any");
  await expect(page.getByTestId("review-bar")).toBeVisible();
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Alerts" }).click();
  await expect(page.getByTestId("alert-settings")).toBeVisible();
});

test("an admin can preview a sample alert without mailing anyone else", async ({ page, request }) => {
  await login(request, "contributor");
  const denied = await request.post("/api/alerts/test");
  expect(denied.status()).toBe(403);

  await login(request, "reviewer");
  const sent = await request.post("/api/alerts/test");
  expect(sent.status()).toBe(200);
  const body = (await sent.json()) as { delivery: string; email: string; message: string };
  expect(body.delivery).toBe("would_send");
  expect(body.email).toBe("reviewer@example.com");
  expect(body.message).toContain("would-send log");
  expect(body.message).toContain("not approved for live mail");

  const again = await request.post("/api/alerts/test");
  expect(again.status()).toBe(429);

  await openAs(page, "reviewer", "/admin/alerts");
  const preview = page.getByTestId("alert-preview");
  await expect(preview.getByTestId("send-test-alert")).toBeVisible();
  await expect(preview).toContainText("[Test]");
  await expect(preview).toContainText("Sample site");
  await preview.getByTestId("send-test-alert").click();
  await expect(preview.getByTestId("test-alert-result")).toContainText("five minutes");
});

test("a mention with no mail credentials is logged as would-send", async ({ page, request }) => {
  await login(request, "contributor");
  const response = await request.post("/api/actions/notes", {
    data: {
      targetKind: "deal",
      targetId: deal,
      body: "Please look at the frontage.",
      mentions: ["reviewer"],
    },
  });
  expect(response.ok()).toBeTruthy();
  await openAs(page, "reviewer", "/admin/alerts");
  const preview = page.getByTestId("alert-preview");
  await expect(preview).toContainText("would-send");
  await expect(preview).toContainText(deal);
  await expect(preview).toContainText("Please look at the frontage.");
  await mkdir("/opt/cursor/artifacts", { recursive: true });
  await page.screenshot({ path: "/opt/cursor/artifacts/alert-would-send.png" });
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
