import { mkdir } from "node:fs/promises";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const password = process.env.E2E_PASSWORD || "e2e-pass-actions";

type DealProps = {
  deal_id?: string;
  kind?: string;
  stage_group?: string;
  is_c_store?: boolean;
};

// The viable queue hides dropped deals and c-stores. Pick one from the file so a sync can change which id that is.
async function activePipelineDeal(request: APIRequestContext): Promise<string> {
  const response = await request.get("/api/data/deals");
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { features?: { properties?: DealProps }[] };
  const ids = (body.features || [])
    .map((feature) => feature.properties || {})
    .filter((props) => props.kind === "pipeline" && props.stage_group !== "dropped" && props.is_c_store !== true && props.deal_id)
    .map((props) => String(props.deal_id))
    .sort();
  expect(ids.length).toBeGreaterThan(0);
  return ids[0];
}

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
  await hideDevOverlay(page);
}

async function hideDevOverlay(page: Page) {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}

async function queue(request: APIRequestContext, query = "market=all&stage=any&viable=1") {
  const response = await request.get(`/api/queue?${query}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as {
    items: { siteId: string; reasons: { summary: string; type: string }[]; snapshot: { lng?: number | null; lat?: number | null; assignments?: { title: string; date: string }[] } | null }[];
  };
}

test("a new site can be reviewed, and a later note puts it back", async ({ page, request }) => {
  await mkdir("/opt/cursor/artifacts", { recursive: true });
  await login(request, "contributor");
  const deal = await activePipelineDeal(request);
  // A failed later test retries this whole file, which can leave the site reviewed or snoozed.
  const unsnooze = await request.post("/api/queue/snooze", { data: { siteId: deal, until: "2000-01-01" } });
  expect(unsnooze.ok()).toBeTruthy();
  const reset = await request.post("/api/queue", { data: { siteId: deal, undo: true } });
  expect(reset.ok()).toBeTruthy();
  const before = await queue(request);
  expect(before.items.some((item) => item.siteId === deal)).toBeTruthy();

  await openAs(page, "contributor", "/?review=1&qmarket=all&qstage=any");
  await expect(page.getByTestId("review-bar")).toBeVisible();
  await expect(page.locator(".drawer")).toBeVisible();
  await expect(page.getByTestId("queue-count")).toBeVisible();

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
  const deal = await activePipelineDeal(request);
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
  const deal = await activePipelineDeal(request);
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
  const pending = await queue(request, "market=all&stage=any&viable=1&approve=1");
  const at = pending.items.findIndex((item) => item.siteId === deal);
  expect(at).toBeGreaterThanOrEqual(0);
  await openAs(page, "reviewer", `/?review=1&qmarket=all&qstage=any&qapprove=1&i=${at + 1}`);
  const panel = page.locator(".drawer");
  await expect(panel).toBeVisible();
  await panel.getByTestId("panel-tab-discussion").click();
  const proposal = panel.getByTestId("proposed-next-step").filter({ hasText: "Ask for the sales package" });
  await expect(proposal).toBeVisible();
  await proposal.getByRole("button", { name: "Send" }).click();
  await expect.poll(async () => {
    const listed = await request.get(`/api/actions/suggestions?targetKind=deal&targetId=${deal}`);
    const body = (await listed.json()) as { suggestions?: { title: string | null; status: string }[] };
    return body.suggestions?.some((item) => item.title === "Ask for the sales package" && item.status === "accepted") || false;
  }).toBeTruthy();
  const after = await request.get("/api/data/deals");
  expect(await after.text()).toBe(beforeBody);
});

test("a mention is queued only for the mentioned account", async ({ page, request }) => {
  await openAs(page, "contributor", "/?review=1&qmarket=all&qstage=any");
  await page.getByTestId("panel-tab-discussion").click();
  const body = page.getByTestId("note-body");
  await body.click();
  await body.fill("Please look at the frontage ");
  await body.pressSequentially("@Rev");
  await expect(page.getByTestId("mention-menu")).toBeVisible();
  await page.getByTestId("mention-menu").getByRole("option", { name: "Reviewer" }).click();
  await expect(page.getByTestId("note-body")).not.toHaveValue(/@/);
  await page.getByRole("button", { name: "Comment" }).click();
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
  const deal = await activePipelineDeal(request);
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

  await openAs(page, "reviewer", "/?review=1&qmarket=all&qstage=any&qassign=1");
  const assignedName = (card?.snapshot as { name?: string } | null)?.name || deal;
  await page.getByTestId("review-assigned").getByRole("button", { name: assignedName }).click();
  await page.getByTestId("panel-tab-discussion").click();
  const panel = page.locator(".drawer");
  await expect(panel.getByTestId("next-step")).toContainText("Schedule a site visit");
  await expect(panel.getByTestId("next-step")).toContainText("Dec 15");
  await panel.getByRole("button", { name: "Mark done" }).click();
  await expect.poll(async () => {
    const again = await queue(request, "market=all&stage=any&viable=1&assigned=1");
    return again.items.some((item) => item.snapshot?.assignments?.some((row) => row.title === "Schedule a site visit"));
  }).toBe(false);

  const csv = await request.get("/api/actions/suggestions/export?kind=next");
  expect(csv.ok()).toBeTruthy();
  const text = await csv.text();
  expect(text.split("\n")[0]).toBe("site_id,date,title,owner,approved_at,done_at,type,stage");
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

  const fresh = await queue(request);
  const placed = fresh.items.findIndex((item) => typeof item.snapshot?.lng === "number");
  const missing = fresh.items.findIndex((item) => item.snapshot?.lng == null);
  expect(placed).toBeGreaterThanOrEqual(0);
  expect(missing).toBeGreaterThanOrEqual(0);

  await openAs(page, "contributor", `/?review=1&qmarket=all&qstage=any&i=${placed + 1}`);
  const controls = page.getByTestId("review-bar");
  const panel = page.locator(".drawer");
  await expect(controls).toBeVisible();
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("review-noloc")).toHaveCount(0);
  await expect(controls.getByRole("button", { name: "Previous" })).toBeVisible();
  await expect(controls.getByRole("button", { name: "Next", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("button", { name: "Pipeline" })).toHaveClass(/on/);
  await page.locator(".maplibregl-canvas").waitFor();
  await expect.poll(async () => page.evaluate(() => {
    const map = (window as unknown as { __sitesMap?: { getZoom: () => number; queryRenderedFeatures?: (opts: { layers: string[] }) => unknown[] } }).__sitesMap;
    if (!map || (map.getZoom() ?? 0) <= 14 || !map.queryRenderedFeatures) return 0;
    try {
      return map.queryRenderedFeatures({ layers: ["review-numbers"] }).length;
    } catch {
      return 0;
    }
  })).toBeGreaterThan(0);
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/opt/cursor/artifacts/queue-desktop.png" });
  const position = page.getByTestId("review-position");
  const first = await position.innerText();
  const move = placed < fresh.items.length - 1 ? "Next" : "Previous";
  await controls.getByRole("button", { name: move, exact: true }).click();
  await expect(position).not.toHaveText(first);
  await expect.poll(async () => page.evaluate(() => {
    const map = (window as unknown as { __sitesMap?: { getZoom: () => number; queryRenderedFeatures?: (opts: { layers: string[] }) => unknown[] } }).__sitesMap;
    if (!map || (map.getZoom() ?? 0) <= 14 || !map.queryRenderedFeatures) return 0;
    try {
      return map.queryRenderedFeatures({ layers: ["review-numbers"] }).length;
    } catch {
      return 0;
    }
  })).toBeGreaterThan(0);
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/opt/cursor/artifacts/queue-desktop-next.png" });

  await page.goto(`/?review=1&qmarket=all&qstage=any&i=${missing + 1}`);
  await hideDevOverlay(page);
  await expect(page.getByTestId("review-noloc")).toBeVisible();
  await page.locator(".maplibregl-canvas").waitFor();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "/opt/cursor/artifacts/queue-noloc.png" });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?review=1&qmarket=all&qstage=any&i=${placed + 1}`);
  await hideDevOverlay(page);
  await expect(controls).toBeVisible();
  await expect(page.getByTestId("review-noloc")).toHaveCount(0);
  await page.locator(".maplibregl-canvas").waitFor();
  await expect.poll(async () => page.evaluate(() => {
    const map = (window as unknown as { __sitesMap?: { getZoom: () => number; queryRenderedFeatures?: (opts: { layers: string[] }) => unknown[] } }).__sitesMap;
    if (!map || (map.getZoom() ?? 0) <= 14 || !map.queryRenderedFeatures) return 0;
    try {
      return map.queryRenderedFeatures({ layers: ["review-numbers"] }).length;
    } catch {
      return 0;
    }
  })).toBeGreaterThan(0);
  await page.screenshot({ path: "/opt/cursor/artifacts/queue-mobile.png" });
  await page.getByTestId("review-position").click();
  await expect(page.getByTestId("review-feed")).toBeVisible();
  await page.screenshot({ path: "/opt/cursor/artifacts/queue-mobile-feed.png" });
});

test("the empty queue and the phone layout", async ({ page, request }) => {
  await login(request, "contributor");
  const cleared = await request.post("/api/queue", { data: { all: true, market: "all", stage: "any", viable: true } });
  expect(cleared.ok()).toBeTruthy();
  await openAs(page, "contributor", "/?review=1&qmarket=all&qstage=any");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByTestId("queue-empty")).toContainText("All caught up");
  await page.screenshot({ path: "/opt/cursor/artifacts/queue-empty-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("queue-empty")).toBeVisible();
  await page.screenshot({ path: "/opt/cursor/artifacts/queue-empty-mobile.png" });
});

test("the review inbox keeps its sections, and an approval ignores market and stage", async ({ page, request }) => {
  await login(request, "contributor");
  const created = await request.post("/api/actions/suggestions", {
    data: {
      targetKind: "deal",
      targetId: "PIPE-PHX-0081",
      field: "proposed_next_step",
      title: "Confirm the frontage",
      targetOn: "2026-12-01",
      proposedValue: "Confirm the frontage",
    },
  });
  expect(created.status()).toBe(201);
  await login(request, "reviewer");
  const queued = await queue(request, "market=LAS&stage=dropped&viable=1");
  expect(queued.items.some((item) => item.siteId === "PIPE-PHX-0081")).toBeTruthy();
  expect(queued.items.some((item) => item.siteId === "PIPE-PHX-0067")).toBeFalsy();

  await openAs(page, "reviewer", "/?review=1&qmarket=LAS&qstage=dropped");
  await expect(page.getByTestId("review-approvals")).toContainText("Needs my approval");
  await expect(page.getByTestId("review-mentions")).toContainText("Mentions");
  await expect(page.getByTestId("review-assigned")).toContainText("Assigned");
  const approval = page.getByTestId("review-approvals").getByRole("button", { name: /Rinse My Ride/ });
  await expect(approval).toBeVisible();
  await expect(approval.locator(".queue-dot")).toBeVisible();
});

test("also in review matches the other inbox sections", async ({ page }) => {
  await openAs(page, "reviewer", "/?review=1&qmarket=all&qstage=any");
  const desktop = page.getByTestId("review-other");
  await expect(desktop.getByRole("heading", { name: "Also in review" })).toBeVisible();
  const desktopRow = desktop.getByRole("button").first();
  await expect(desktopRow).toBeVisible();
  await expect.poll(() => desktopRow.evaluate((el) => getComputedStyle(el).display)).toBe("grid");

  await page.setViewportSize({ width: 390, height: 800 });
  await page.getByTestId("review-position").click();
  const sheet = page.getByTestId("review-feed");
  const other = sheet.getByTestId("review-other-sheet");
  const heading = other.getByRole("heading", { name: "Also in review" });
  await expect(heading).toBeVisible();
  const assigned = sheet.getByTestId("review-assigned-sheet").getByRole("heading", { name: "Assigned" });
  const headingPad = await heading.evaluate((el) => getComputedStyle(el).paddingTop);
  const assignedPad = await assigned.evaluate((el) => getComputedStyle(el).paddingTop);
  expect(headingPad).toBe(assignedPad);
  const row = other.getByRole("button").first();
  await expect(row).toBeVisible();
  await expect.poll(() => row.evaluate((el) => getComputedStyle(el).display)).toBe("grid");
  await expect.poll(() => row.evaluate((el) => getComputedStyle(el).textAlign)).toBe("left");
});

test("the review filter menu stays inside a 390px screen", async ({ page }) => {
  await openAs(page, "reviewer", "/?review=1&qmarket=all&qstage=any");
  await page.setViewportSize({ width: 390, height: 800 });
  await page.getByTestId("queue-filters").click();
  const pop = page.locator(".queue-pop");
  await expect(pop).toBeVisible();
  const box = await pop.boundingBox();
  expect(box).toBeTruthy();
  if (box) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
  await expect(pop.getByRole("button", { name: "Active" })).toBeVisible();
  await expect(pop.getByLabel("Queue market")).toBeVisible();
  await expect(pop.getByLabel("Queue stage")).toBeVisible();
  await page.getByTestId("queue-filters").click();
  await expect(pop).toBeHidden();
  await page.getByTestId("review-position").click();
  await expect(page.getByTestId("review-feed")).toBeVisible();
  await page.getByTestId("queue-filters").click();
  await expect(pop.getByRole("button", { name: "Active" })).toBeVisible();
  const covered = await pop.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + 28);
    return hit ? !el.contains(hit) : true;
  });
  expect(covered).toBe(false);
});
