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
async function pipelineDeals(request: APIRequestContext): Promise<string[]> {
  const response = await request.get("/api/data/deals");
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { features?: { properties?: DealProps }[] };
  const ids = (body.features || [])
    .map((feature) => feature.properties || {})
    .filter((props) => props.kind === "pipeline" && props.stage_group !== "dropped" && props.is_c_store !== true && props.deal_id)
    .map((props) => String(props.deal_id))
    .sort();
  expect(ids.length).toBeGreaterThan(1);
  return ids;
}

async function activePipelineDeal(request: APIRequestContext): Promise<string> {
  return (await pipelineDeals(request))[0];
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
  const { note: { id } } = await note.json() as { note: { id: string } };
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto(`/?review=1&rsite=${deal}&qmarket=all&qstage=any`);
    const changes = page.getByTestId("review-since");
    await changes.click();
    const position = await page.getByTestId("review-position").innerText();
    const line = page.getByTestId("review-since-list").getByRole("button", { name: /New note/ }).first();
    await line.click();
    const banner = page.getByRole("region", { name: "Selected review change" });
    await expect(banner).toContainText("New note");
    await expect(page.getByRole("tab", { name: "Discussion" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(`[data-note-id="${id}"]`)).toBeInViewport();
    await mkdir("review-shots", { recursive: true });
    await banner.screenshot({ path: `review-shots/${width === 390 ? "mobile" : "desktop"}-review-change.png` });
    await banner.getByRole("button", { name: "Back to review" }).click();
    await expect(line).toBeFocused();
    await expect(page.getByTestId("review-position")).toHaveText(position, { useInnerText: true });
    const query = new URL(page.url()).searchParams;
    expect(query.get("rsite")).toBe(deal);
    expect(query.get("qmarket")).toBe("all");
    expect(query.get("qstage")).toBe("any");
  }
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
  await login(request, "contributor");
  // Mentions is listed before Assigned, and a site is shown in only one group.
  // This mention uses a different deal so the first deal can still appear under Assigned.
  const deal = (await pipelineDeals(request)).at(-1)!;
  await openAs(page, "contributor", `/?funnel=pipeline&site=${deal}&panel=discussion`);
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
  const assignedRow = page.getByTestId("review-assigned").locator(`[data-site="${deal}"]`);
  await assignedRow.scrollIntoViewIfNeeded();
  await assignedRow.click();
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
  expect(placed).toBeGreaterThanOrEqual(0);

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

  // Model an unlocated site even when every current queue record has been mapped.
  const noLocationId = fresh.items[placed].siteId;
  await page.route("**/api/data/deals", async route => {
    const response = await route.fetch();
    const data = await response.json();
    const feature = data.features.find((item: { properties: { deal_id: string } }) => item.properties.deal_id === noLocationId);
    feature.geometry = null;
    feature.properties.universe_id = null;
    await route.fulfill({ response, json: data });
  });
  await page.route("**/api/queue?*", async route => {
    const response = await route.fetch();
    const data = await response.json();
    const row = data.items?.find((item: { siteId: string }) => item.siteId === noLocationId);
    if (row?.snapshot) Object.assign(row.snapshot, { lat: null, lng: null });
    await route.fulfill({ response, json: data });
  });
  await page.goto(`/?review=1&qmarket=all&qstage=any&rsite=${noLocationId}`);
  await hideDevOverlay(page);
  await expect(page.getByTestId("review-noloc")).toBeVisible();
  await page.locator(".maplibregl-canvas").waitFor();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "/opt/cursor/artifacts/queue-noloc.png" });
  await page.unrouteAll({ behavior: "wait" });

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
  const since = page.getByTestId("review-since");
  if (await since.count()) {
    await expect(since).toBeVisible();
    const label = await since.evaluate((node) => {
      const style = window.getComputedStyle(node);
      return { fontSize: style.fontSize, text: (node.textContent || "").trim() };
    });
    expect(label.fontSize).not.toBe("0px");
    expect(label.text.length).toBeGreaterThan(0);
  }
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

for (const width of [1440, 390]) {
  test(`five screening findings keep their sources, permissions and review context at ${width}px`, async ({ page, request }) => {
    test.slow();
    await login(request, "contributor");
    const deal = await activePipelineDeal(request);
    const response = await request.get("/api/data/sites?city=PHX");
    const data = await response.json() as { features: { properties: { site_id: string; linked_deal_id?: string } }[] };
    const extra = data.features.map(item => item.properties).filter(site => /^PHX-U\d+$/.test(site.site_id) && !site.linked_deal_id && !["PHX-U189", "PHX-U645"].includes(site.site_id)).slice(0, 2);
    const ids = ["PHX-U189", "PHX-U645", ...extra.map(site => site.site_id), deal];
    expect(new Set(ids).size).toBe(5);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await openAs(page, "contributor", "/?funnel=universe&city=PHX");
    await mkdir("review-shots", { recursive: true });
    for (const [index, id] of ids.entries()) {
      const inQueue = id === deal;
      if (inQueue) {
        await request.post("/api/queue/snooze", { data: { siteId: id, until: "2000-01-01" } });
        await request.post("/api/queue", { data: { siteId: id, undo: true } });
      }
      await page.goto(inQueue ? `/?review=1&rsite=${id}&qstage=any&qmarket=all&sheet=full` : `/?funnel=universe&site=${id}&city=PHX&sheet=full${index === 0 ? "&panel=finding" : ""}`);
      const record = page.locator("aside.drawer");
      await expect(record).toHaveAttribute("data-record", id);
      const before = inQueue ? await page.getByTestId("review-position").innerText() : "";
      const brief = record.getByRole("region", { name: "Screening decision" });
      if (index !== 0) await brief.getByRole("button", { name: "Record finding", exact: true }).click();
      const form = brief.getByRole("form", { name: "Record finding" });
      if (index === 0) await expect(form.getByRole("textbox", { name: "Source", exact: true })).toHaveValue(/^https?:/);
      if (index === 1) {
        await expect(brief).toContainText("County record link not on file.");
        await form.getByLabel("Record as").selectOption("missing");
      }
      if (index === 2) {
        await form.getByLabel("Record as").selectOption("proposal");
        await form.getByLabel("Field", { exact: true }).selectOption("zoning");
        await form.getByLabel("Proposed value").fill("Review classification");
      }
      const finding = index === 1 ? "Parcel reference still needed." : "Parcel boundary checked against the source.";
      await form.getByRole("textbox", { name: index === 1 ? "What is still missing?" : "What did you find?" }).fill(finding);
      await form.getByRole("textbox", { name: "Source", exact: true }).fill("Example county assessment map");
      if (index === 0) await form.screenshot({ path: `review-shots/${width}-finding-editor.png` });
      await form.getByRole("button", { name: index === 2 ? "Submit for approval" : index === 1 ? "Save evidence gap" : "Save finding" }).click();
      const title = index === 2 ? "Change submitted for approval" : index === 1 ? "Evidence gap saved" : "Finding saved";
      await expect(brief.getByRole("status")).toContainText(title);
      if (inQueue) {
        await brief.getByRole("button", { name: "Return to review" }).click();
        await expect(page.getByTestId("review-since")).toBeFocused();
        await expect(page.getByTestId("review-position")).toHaveText(before, { useInnerText: true });
        expect(new URL(page.url()).searchParams.get("rsite")).toBe(id);
      } else {
        await page.reload();
        await expect(brief.getByRole("status")).toContainText(title);
        await expect(brief.getByRole("status")).toContainText("Example county assessment map");
        if (index === 1) await expect(brief.getByRole("status")).toContainText("Unassigned");
        if (index === 2) {
          const res = await request.get(`/api/actions/suggestions?targetKind=site&targetId=${id}`);
          expect((await res.json()).suggestions.some((entry: { status: string; reason: string }) => entry.status === "open" && entry.reason.includes("Example county assessment map"))).toBe(true);
          await brief.getByRole("status").screenshot({ path: `review-shots/${width}-finding-approval.png` });
        }
      }
    }
    await openAs(page, "viewer", "/?site=PHX-U189&sheet=full");
    await expect(page.getByRole("region", { name: "Screening decision" }).getByRole("status")).toContainText("Finding saved");
    await expect(page.getByRole("button", { name: "Record finding", exact: true })).toHaveCount(0);
  });
}

for (const width of [1440, 390]) {
  test(`five-site comparison reopens with its evidence and reviewer handoff at ${width}px`, async ({ page, request }, info) => {
    test.slow();
    await login(request, "reviewer");
    const catalog = await (await request.get("/api/data/sites?city=PHX")).json();
    type Site = { properties: { site_id: string; name: string; counts_as_site: boolean; linked_deal_id?: string; city: string; origin: string } };
    const names = ["Canyon Wash", "Desert Palm Wash", "Mesa Wash", "North Valley Wash", "Sonoran Wash", "Valley Wash"];
    const cohort = (catalog.features as Site[]).filter(f => f.properties.city === "PHX" && f.properties.origin === "universe" && f.properties.counts_as_site && !f.properties.linked_deal_id).slice(0, 6).map((f, i) => ({
      ...f, properties: { ...f.properties, name: names[i], address: (100 + i) + " Example Ave", business_type: "Car wash", counts_as_site: true,
        land_only: false, duplicate_of: "", in_area: true, service_area_class: "inside", land_tier: i < 5 ? "L10" : "", tenure_fail: false,
        spare_ac_own: i < 5 ? (i + 3) / 10 : null, spare_ac_own_text: "", verdict: "", owner: "", asking_price_display: "", summary_why: "" },
    }));
    expect(cohort).toHaveLength(6);
    const id = cohort[0].properties.site_id;
    const source = "Example county assessment map";
    const note = async (body: string) => {
      const response = await request.post("/api/actions/notes", { data: { targetKind: "site", targetId: id, body } });
      expect(response.status()).toBe(201);
      return (await response.json()).note.id as string;
    };
    await note("Screening finding\nParcel boundary located.\nCheck: Verify parcel.\nSource: " + source);
    const gapText = width === 390 ? "Confirm the rear parcel boundary." : "Confirm rear parcel access.";
    const gapId = await note("Missing evidence\n" + gapText + "\nCheck: Verify usable land.\nSource: " + source);
    const created = await request.post("/api/actions/suggestions", { data: { targetKind: "site", targetId: id, field: "proposed_next_step", title: "Verify rear parcel access", proposedValue: "Verify rear parcel access", ownerId: "contributor" } });
    expect(created.status()).toBe(201);
    const step = (await created.json()).suggestion;
    expect((await request.post("/api/actions/suggestions/" + step.id, { data: { status: "accepted" } })).ok()).toBeTruthy();
    await page.route("**/api/data/sites**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/data/sites") return route.fulfill({ json: { ...catalog, features: cohort } });
      const site = cohort.find(row => path.endsWith("/" + row.properties.site_id));
      if (site) return route.fulfill({ json: site.properties });
      return route.continue();
    });
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await openAs(page, "contributor", "/?funnel=universe&city=PHX&stage=in_area&view=list&sort=site:asc");
    const scope = page.locator(".workspace-scope:visible");
    await expect(scope).toContainText("6 sites");
    await scope.click();
    await page.getByRole("navigation", { name: "Funnel" }).getByRole("button", { name: /Open land/ }).click();
    await expect(scope).toContainText("5 sites");
    const rows = page.locator(".pipeline-list [data-site-row]");
    await expect(rows).toHaveCount(5);
    const capture = async (moment: string, surface = page.locator("body")) => {
      const dir = process.env.UX_REVIEW_DIR;
      if (!dir) return;
      await mkdir(dir, { recursive: true });
      await page.addStyleTag({ content: "nextjs-portal { display:none !important }" });
      await surface.screenshot({ path: dir + "/" + width + "-" + moment + ".png", animations: "disabled" });
    };
    await capture("shortlist");
    if (width === 390) {
      await page.getByRole("button", { name: "More list actions" }).click();
      await page.getByRole("menuitem", { name: "Select", exact: true }).click();
    }
    await rows.nth(0).getByRole("checkbox").check();
    await rows.nth(1).getByRole("checkbox").check();
    await page.getByTestId("selection-bar").getByRole("button", { name: "Compare" }).click();
    const tray = page.getByTestId("compare-tray");
    const figure = tray.getByRole("button", { name: "Inspect Open land for Canyon Wash" });
    await expect(figure).toBeVisible();
    await capture("compare", tray);
    await page.route("**/api/ask/status", route => route.fulfill({ json: { ready: true } }));
    await page.route("**/api/ask", route => {
      expect(route.request().postDataJSON().siteIds).toEqual(cohort.slice(0, 2).map(row => row.properties.site_id));
      return route.fulfill({ contentType: "text/event-stream", body: "data: " + JSON.stringify({
        done: true, text: "Open land is recorded. [Parcel evidence](/?site=" + id + ")",
      }) + "\n\n" });
    });
    await tray.getByRole("button", { name: "Ask about these sites" }).click();
    const ask = page.getByTestId("ask-panel");
    await expect(ask.getByRole("combobox")).toHaveValue("list");
    await ask.getByRole("button", { name: "Compare fit and economics" }).click();
    await ask.getByRole("button", { name: "Ask", exact: true }).click();
    await ask.getByRole("link", { name: "Parcel evidence" }).click();
    await page.getByRole("button", { name: /Back to comparison/ }).click();
    await expect(tray).toBeVisible();
    await figure.click();
    const drawer = page.locator("aside.drawer");
    await expect(drawer).toHaveAttribute("data-record", id);
    await expect(drawer.locator('[data-evidence="open-land"]')).toBeInViewport();
    await capture("evidence", drawer);
    await drawer.getByRole("button", { name: /Back to comparison/ }).click();
    await expect(figure).toBeFocused();
    await tray.getByRole("button", { name: "Save comparison" }).click();
    const title = width === 390 ? "Phoenix field review" : "Phoenix finalists";
    const name = info.retry ? title + " · retry " + info.retry : title;
    const form = tray.getByRole("form", { name: "Save comparison" });
    await form.getByLabel("Comparison name").fill(name);
    await page.route("**/api/actions/views", async route => {
      if (route.request().method() !== "POST") return route.continue();
      await route.fetch();
      return route.abort("failed");
    }, { times: 1 });
    await form.getByRole("button", { name: "Save", exact: true }).click();
    await expect(form.getByRole("alert")).toBeVisible();
    await form.getByRole("button", { name: "Save", exact: true }).click();
    await expect(tray.getByRole("status").filter({ hasText: name })).toBeVisible();
    await tray.getByRole("button", { name: "Saved views" }).click();
    const row = page.getByTestId("views-panel").getByRole("listitem").filter({ hasText: name });
    await expect(row).toHaveCount(1);
    await row.getByRole("button", { name: "Open", exact: true }).click();
    await expect(scope).toContainText("5 sites");
    await expect(page).toHaveURL(/stage=land/);
    expect(new URL(page.url()).searchParams.get("sort")).toBe("site:asc");
    await expect(tray.getByRole("status").filter({ hasText: name })).toBeVisible();
    await capture("saved", tray);
    await expect(figure).toBeVisible();
    await figure.click();
    const brief = drawer.getByRole("region", { name: "Screening decision" });
    await expect(brief).toContainText(source);
    const gap = brief.getByRole("status");
    await expect(gap).toContainText(gapText);
    await expect(gap).toContainText("Unassigned");
    await expect(gap).not.toContainText("Verify rear parcel access");
    await gap.getByRole("button", { name: "Propose gap action" }).click();
    const work = drawer.getByTestId("next-step-form");
    await expect(work.getByLabel("Title")).toHaveValue(gapText);
    await work.getByLabel("Assignee", { exact: true }).selectOption("contributor");
    await work.getByLabel("Due", { exact: true }).fill("2030-04-15");
    await work.getByRole("button", { name: "Submit for approval" }).click();
    await expect(gap).toContainText("Awaiting approval");
    await expect(gap).toContainText("Contributor");
    await expect(gap).toContainText("2030-04-15");
    const proposals = (await (await request.get("/api/actions/suggestions?targetKind=site&targetId=" + id)).json()).suggestions;
    const linked = proposals.find((p: { reason: string }) => p.reason.endsWith("note=" + gapId));
    expect(linked.status).toBe("open");
    expect((await request.post("/api/actions/suggestions/" + linked.id, { data: { status: "accepted" } })).ok()).toBe(true);
    await page.reload();
    await expect(gap).toContainText("Approved");
    await expect(drawer.getByTestId("next-step").getByRole("link", { name: "Open evidence thread" })).toHaveAttribute("href", new RegExp("note=" + gapId));
    await gap.getByRole("button", { name: "Open evidence thread" }).click();
    const thread = drawer.locator('[data-note-id="' + gapId + '"]');
    await expect(thread).toContainText(gapText);
    expect(new URL(page.url()).searchParams.get("note")).toBe(gapId);
    await expect(brief.getByRole("time").first()).toBeAttached();
    await brief.locator("summary").filter({ hasText: "Earlier findings" }).click();
    await expect(brief).toContainText("Parcel boundary located.");
    await capture("handoff", brief);
    expect((await request.post("/api/actions/notes", { data: { targetKind: "site", targetId: id, parentId: gapId, body: "Field check confirmed the access line on the assessment map." } })).ok()).toBe(true);
    expect((await request.post("/api/actions/notes/" + gapId + "/resolve", { data: {} })).ok()).toBe(true);
    await page.reload();
    await expect(gap).toContainText("Evidence gap resolved");
    await expect(thread).toContainText("Field check confirmed");
    await expect(gap.getByRole("button", { name: "Propose gap action" })).toHaveCount(0);
  });
}
