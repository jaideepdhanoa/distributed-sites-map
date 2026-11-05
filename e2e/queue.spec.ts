import { mkdir } from "node:fs/promises";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const password = process.env.E2E_PASSWORD || "e2e-pass-actions";
const deal = "PIPE-PHX-0008";

test.describe.configure({ mode: "serial" });

async function login(request: APIRequestContext, username: string) {
  const response = await request.post("/api/login", { data: { username, password } });
  expect(response.ok()).toBeTruthy();
}

async function openAs(page: Page, username: string, path: string) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.goto(path);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}

async function queue(request: APIRequestContext, query = "market=all&stage=any&viable=1") {
  const response = await request.get(`/api/queue?${query}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as {
    items: { siteId: string; reasons: { summary: string; type: string }[]; snapshot: { assignments?: { title: string; date: string }[] } | null }[];
  };
}

test("a new site can be reviewed, and a later note puts it back", async ({ page, request }) => {
  await mkdir("/opt/cursor/artifacts", { recursive: true });
  await login(request, "contributor");
  const before = await queue(request);
  expect(before.items.some((item) => item.siteId === deal)).toBeTruthy();

  await openAs(page, "contributor", "/?view=queue&qmarket=all&qstage=any");
  await expect(page.getByTestId("queue-card")).toBeVisible();
  await expect(page.getByTestId("queue-count")).toBeVisible();
  await expect(page.getByRole("button", { name: "Map" }).first()).toBeVisible();

  const reviewed = await request.post("/api/queue", { data: { siteId: deal } });
  expect(reviewed.ok()).toBeTruthy();
  expect((await queue(request)).items.some((item) => item.siteId === deal)).toBeFalsy();

  const note = await request.post("/api/actions/notes", {
    data: { targetKind: "deal", targetId: deal, body: "The frontage needs another look." },
  });
  expect(note.status()).toBe(201);
  const again = await queue(request);
  expect(again.items.find((item) => item.siteId === deal)?.reasons.some((reason) => reason.summary === "New note.")).toBeTruthy();
});

test("flagging shows the site to the other account, and snooze hides it until the date", async ({ request }) => {
  await login(request, "contributor");
  const flagged = await request.post("/api/queue/flag", { data: { siteId: deal, toUser: "reviewer", note: "Please take this one next." } });
  expect(flagged.ok()).toBeTruthy();
  await login(request, "reviewer");
  const theirs = await queue(request, "market=all&stage=any&viable=1&flagged=1");
  expect(theirs.items.some((item) => item.siteId === deal && item.reasons.some((reason) => reason.summary.startsWith("Flagged for you.")))).toBeTruthy();
  await login(request, "contributor");
  const mine = await queue(request, "market=all&stage=any&viable=1&flagged=1");
  expect(mine.items.some((item) => item.siteId === deal)).toBeFalsy();

  const snooze = await request.post("/api/queue/snooze", { data: { siteId: deal, until: "2099-01-01" } });
  expect(snooze.ok()).toBeTruthy();
  expect((await queue(request)).items.some((item) => item.siteId === deal)).toBeFalsy();
});

test("a reviewer can approve a next step from the queue", async ({ page, request }) => {
  await login(request, "contributor");
  const before = await request.get("/api/data/deals");
  const beforeBody = await before.text();
  const created = await request.post("/api/actions/suggestions", {
    data: {
      targetKind: "deal",
      targetId: deal,
      field: "proposed_next_step",
      title: "Ask for the sales package",
      targetOn: "2026-12-01",
      proposedValue: "Ask for the sales package",
    },
  });
  expect(created.status()).toBe(201);

  await login(request, "reviewer");
  await openAs(page, "reviewer", "/?view=queue&qmarket=all&qstage=any&qapprove=1");
  const queueCard = page.getByTestId("queue");
  await expect(queueCard).toBeVisible();
  for (let step = 0; step < 40; step += 1) {
    if (await queueCard.getByText("Ask for the sales package").count()) break;
    await queueCard.getByRole("button", { name: "Next", exact: true }).click();
  }
  const proposal = queueCard.locator("li", { hasText: "Ask for the sales package" }).filter({ has: page.getByRole("button", { name: "Accept" }) });
  await expect(proposal).toBeVisible();
  await proposal.getByRole("button", { name: "Accept" }).click();
  await expect.poll(async () => {
    const listed = await request.get(`/api/actions/suggestions?targetKind=deal&targetId=${deal}`);
    const body = (await listed.json()) as { suggestions?: { title: string | null; status: string }[] };
    return body.suggestions?.some((item) => item.title === "Ask for the sales package" && item.status === "accepted") || false;
  }).toBeTruthy();
  const after = await request.get("/api/data/deals");
  expect(await after.text()).toBe(beforeBody);
});

test("a mention is queued only for the mentioned account", async ({ page, request }) => {
  await openAs(page, "contributor", "/?view=queue&qmarket=all&qstage=any");
  const body = page.getByTestId("note-body");
  await body.click();
  await body.fill("Please look at the frontage ");
  await body.pressSequentially("@Rev");
  await expect(page.getByTestId("mention-menu")).toBeVisible();
  await page.getByTestId("mention-menu").getByRole("option", { name: "Reviewer" }).click();
  await expect(page.getByTestId("note-body")).not.toHaveValue(/@/);
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByTestId("mention-chip").first()).toContainText("Reviewer");

  await login(request, "reviewer");
  const mentioned = await queue(request, "market=all&stage=any&viable=1&mentions=1");
  expect(mentioned.items.some((item) => item.reasons.some((reason) => reason.summary === "Mentioned you."))).toBeTruthy();
  await login(request, "viewer");
  const other = await queue(request, "market=all&stage=any&viable=1&mentions=1");
  expect(other.items.some((item) => item.reasons.some((reason) => reason.type === "mention"))).toBeFalsy();
});

test("an assignment shows under Assigned to me, and a non-owner cannot mark it done", async ({ page, request }) => {
  await login(request, "contributor");
  const created = await request.post("/api/actions/suggestions", {
    data: {
      targetKind: "deal",
      targetId: deal,
      field: "proposed_next_step",
      title: "Schedule a site visit",
      targetOn: "2026-12-15",
      ownerId: "reviewer",
      proposedValue: "Schedule a site visit",
    },
  });
  expect(created.status()).toBe(201);
  const suggestion = ((await created.json()) as { suggestion: { id: string } }).suggestion;
  const denied = await request.post(`/api/actions/suggestions/${suggestion.id}/done`);
  expect(denied.status()).toBe(403);

  await login(request, "reviewer");
  const accepted = await request.post(`/api/actions/suggestions/${suggestion.id}`, { data: { status: "accepted" } });
  expect(accepted.ok()).toBeTruthy();
  const assigned = await queue(request, "market=all&stage=any&viable=1&assigned=1");
  const card = assigned.items.find((item) => item.siteId === deal);
  expect(card?.snapshot?.assignments?.some((item) => item.title === "Schedule a site visit" && item.date === "2026-12-15")).toBeTruthy();

  await openAs(page, "reviewer", "/?view=queue&qmarket=all&qstage=any&qassign=1");
  const block = page.getByTestId("queue-assignments");
  await expect(block).toContainText("Schedule a site visit");
  await expect(block).toContainText("2026-12-15");
  await block.locator("li", { hasText: "Schedule a site visit" }).getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("queue")).not.toContainText("Schedule a site visit");

  const csv = await request.get("/api/actions/suggestions/export?kind=next");
  expect(csv.ok()).toBeTruthy();
  const text = await csv.text();
  expect(text.split("\n")[0]).toBe("site_id,date,title,owner,approved_at,done_at");
  const line = text.split("\n").find((item) => item.includes("Schedule a site visit"));
  expect(line).toBeTruthy();
  expect(line).toMatch(/T\d{2}:/);
});

test("the queue card shows a change, a mention, and a pending next step", async ({ page, request }) => {
  await login(request, "contributor");
  const listed = await queue(request);
  const siteId = listed.items[listed.items.length - 1]?.siteId;
  expect(siteId).toBeTruthy();
  const note = await request.post("/api/actions/notes", {
    data: { targetKind: "deal", targetId: siteId, body: "Please look at the frontage.", mentions: ["reviewer"] },
  });
  expect(note.status()).toBe(201);
  const step = await request.post("/api/actions/suggestions", {
    data: {
      targetKind: "deal",
      targetId: siteId,
      field: "proposed_next_step",
      title: "Ask for the sales package",
      targetOn: "2026-12-01",
      proposedValue: "Ask for the sales package",
    },
  });
  expect(step.status()).toBe(201);

  await openAs(page, "contributor", "/?view=queue&qmarket=all&qstage=any");
  const card = page.getByTestId("queue-card");
  await expect(card).toContainText("Please look at the frontage.");
  await expect(card.getByTestId("mention-chip").first()).toContainText("Reviewer");
  await expect(card.getByTestId("note-body")).toBeVisible();
  await expect(card.getByTestId("next-step")).toContainText("Ask for the sales package");
  await page.setViewportSize({ width: 1440, height: 1100 });
  await card.locator("h2").evaluate((node) => node.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: "/opt/cursor/artifacts/queue-card-desktop.png" });
  await page.getByTestId("queue-more").click();
  await expect(page.getByTestId("queue-menu")).toBeVisible();
  await page.screenshot({ path: "/opt/cursor/artifacts/queue-menu-desktop.png" });
  await page.getByTestId("queue-more").click();
  await page.setViewportSize({ width: 390, height: 1280 });
  await card.locator("h2").evaluate((node) => node.scrollIntoView({ block: "start" }));
  await expect(card.getByTestId("note-body")).toBeVisible();
  await page.screenshot({ path: "/opt/cursor/artifacts/queue-card-mobile.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("queue-more").click();
  await expect(page.getByTestId("queue-menu")).toBeVisible();
  await page.screenshot({ path: "/opt/cursor/artifacts/queue-menu-mobile.png" });
});

test("the empty queue and the phone layout", async ({ page, request }) => {
  await login(request, "contributor");
  const cleared = await request.post("/api/queue", { data: { all: true, market: "all", stage: "any", viable: true } });
  expect(cleared.ok()).toBeTruthy();
  await openAs(page, "contributor", "/?view=queue&qmarket=all&qstage=any");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByTestId("queue-empty")).toHaveText("You're all caught up.");
  await page.screenshot({ path: "/opt/cursor/artifacts/queue-empty-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("queue-empty")).toBeVisible();
  await page.screenshot({ path: "/opt/cursor/artifacts/queue-empty-mobile.png" });
});
