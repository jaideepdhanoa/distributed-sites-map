import { expect, test } from "@playwright/test";

const row = {
  nda_id: "NDA-902",
  counterparty_firm: "Sample Firm",
  counterparty_person: "Sample Person",
  scope: "Confidential sample listing",
  site_ids: "",
  nda_status: "Our form sent",
  nda_form: "",
  nda_waiting_on: "Them",
  nda_opened_date: "2026-11-01",
  nda_sent_date: "",
  nda_last_action_date: "2026-11-01",
  nda_waiting_on_since: "2026-11-01",
  nda_executed_date: "",
  nda_gates: "",
  nda_days_open: null,
  nda_days_in_court: null,
  source: "fixture",
  notes: "Sample register note.",
  owner: "",
  next_step: "Wait for a reply.",
  last_action: "",
  version: 0,
  history: [{ status: "Our form sent", note: "On the register", actor: "", at: "2026-11-01" }],
  stage: "our_form_sent",
  court: "them",
  court_detail: "",
  court_since: "2026-11-01",
  next_step_due: "2026-11-01",
  document_url: "",
  document_kind: "",
  contact_name: "Sample Person",
  contact_email: "person@example.com",
  contact_phone: "",
  gmail_thread_ids: ["threadsample01"],
  covered_refs: ["Confidential sample listing"],
  source_ref: "",
  conflict: "Register last action is older than the latest saved record.",
  court_pill: "Their court 22d",
  days_court: 22,
};

test("a dossier without a site opens, and edit posts one change", async ({ page }, info) => {
  if (info.project.name === "mobile") await page.setViewportSize({ width: 360, height: 800 });
  await page.route("**/api/data/nda", (route) => route.fulfill({ json: { source: "fixture", as_of: "2026-11-23", label: "Sample", queue: [row] } }));
  let posted = "";
  await page.route("**/api/changes", async (route) => {
    posted = route.request().postData() || "";
    await route.fulfill({ json: { results: [{ version: 1 }] } });
  });
  await page.route("**/api/actions/accounts", (route) => route.fulfill({ json: { accounts: [{ id: "sample-owner", name: "Sample Owner" }] } }));
  await page.goto("/?nda=NDA-902", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("nda-detail")).toBeVisible();
  await expect(page.getByTestId("nda-no-site")).toBeVisible();
  await expect(page.getByTestId("nda-conflict")).toBeVisible();
  await page.getByTestId("nda-edit").click();
  await page.getByLabel("Status note").fill("Stage moved in the sample.");
  await page.getByTestId("nda-save").click();
  await expect.poll(() => posted).toContain('"entity_type":"nda"');
  expect(posted).toContain("NDA-902");
  expect(posted).toContain("our_form_sent");
  if (info.project.name === "mobile") {
    await page.screenshot({ path: "review-shots/nda-dossier-phone.png", fullPage: false });
  } else {
    await page.screenshot({ path: "review-shots/nda-dossier-desktop.png", fullPage: false });
  }
});

test("a cleared field shows on the dossier and an emptied link is posted blank", async ({ page }) => {
  const filled = {
    ...row,
    document_url: "https://example.com/sample-doc",
    document_kind: "docusign",
    history: [
      ...row.history,
      { status: "Cleared contact phone", note: "", actor: "muse", at: "2026-11-22T18:00:00Z" },
    ],
  };
  await page.route("**/api/data/nda", (route) => route.fulfill({ json: { source: "fixture", as_of: "2026-11-23", label: "Sample", queue: [filled] } }));
  let posted = "";
  await page.route("**/api/changes", async (route) => {
    posted = route.request().postData() || "";
    await route.fulfill({ json: { results: [{ version: 2 }] } });
  });
  await page.route("**/api/actions/accounts", (route) => route.fulfill({ json: { accounts: [{ id: "sample-owner", name: "Sample Owner" }] } }));
  await page.goto("/?nda=NDA-902", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("nda-history")).toContainText("Cleared contact phone");
  await expect(page.getByTestId("nda-clears")).toContainText("Cleared contact phone");
  await page.getByTestId("nda-edit").click();
  await page.getByLabel("Document link").fill("");
  await page.getByLabel("Status note").fill("Sample link removed.");
  await page.getByTestId("nda-save").click();
  await expect.poll(() => posted).toContain('"document_url":""');
  const body = JSON.parse(posted) as { changes: { source: string; payload: Record<string, unknown> }[] };
  expect(body.changes[0]?.source).toBe("NDA queue");
  expect(body.changes[0]?.payload.source_ref).toBe("nda-dossier");
  expect(body.changes[0]?.payload.document_url).toBe("");
  expect(body.changes[0]?.payload.contact_name).toBe("Sample Person");
  expect(body.changes[0]?.payload.contact_phone).toBeUndefined();
});

test("a saved contact beats a derived one and the court pill sits at the right", async ({ page }) => {
  const saved = {
    ...row,
    counterparty_firm: "Sample Horizon Commercial Partners Group",
    version: 2,
    contact_email: "person@example.com",
    contact_phone: "ext 4",
    document_url: "https://example.com/sample-doc",
    document_kind: "docusign",
  };
  await page.route("**/api/data/nda**", async (route) => {
    const activity = new URL(route.request().url()).searchParams.get("activity");
    if (activity) {
      await route.fulfill({
        json: {
          items: [{
            id: "CM-901",
            at: "Nov 20, 12:57 PM",
            direction: "in",
            person: "Other Counsel",
            subject: "Form",
            summary: "Asked about the utility sign-off and the rest of this note runs past the edge of the activity panel.",
            href: "",
            thread: "CM-901",
          }],
          contact_email: "other@example.com",
          contact_phone: "ext 9",
          document_url: "https://example.com/other",
        },
      });
      return;
    }
    await route.fulfill({ json: { source: "fixture", as_of: "2026-11-23", label: "Sample", queue: [saved] } });
  });
  await page.route("**/api/actions/accounts", (route) => route.fulfill({ json: { accounts: [] } }));
  await page.goto("/?nda=1", { waitUntil: "domcontentloaded" });
  const card = page.getByTestId("nda-card-NDA-902");
  await expect(card).toBeVisible();
  const placed = await card.evaluate((node) => {
    const line = node.querySelector(".nda-line");
    const pill = node.querySelector(".court-pill");
    const firm = node.querySelector("strong");
    if (!line || !pill || !firm) return null;
    const lineBox = line.getBoundingClientRect();
    const pillBox = pill.getBoundingClientRect();
    const firmBox = firm.getBoundingClientRect();
    return {
      rightGap: lineBox.right - pillBox.right,
      between: pillBox.left - firmBox.right,
      sameLine: Math.abs(pillBox.top - firmBox.top) < 8,
    };
  });
  expect(placed).not.toBeNull();
  expect(placed?.sameLine).toBe(true);
  expect(placed?.rightGap ?? 99).toBeLessThan(8);
  expect(placed?.between ?? 0).toBeGreaterThan(8);
  await card.click();
  const summary = page.getByTestId("nda-summary");
  await expect(summary).toBeVisible();
  await expect(page.getByTestId("nda-email")).toHaveText("person@example.com");
  await expect(page.getByTestId("nda-email")).not.toContainText("other@example.com");
  await expect(page.getByTestId("nda-phone")).toHaveText("ext 4");
  await expect(page.getByTestId("nda-document").locator("a")).toHaveAttribute("href", "https://example.com/sample-doc");
  const clip = await summary.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      overflow: style.textOverflow,
      white: style.whiteSpace,
      clipped: node.scrollWidth > node.clientWidth + 1,
    };
  });
  expect(clip.overflow).toBe("ellipsis");
  expect(clip.white).toBe("nowrap");
  expect(clip.clipped).toBe(true);
  await page.getByTestId("nda-edit").click();
  await expect(page.getByTestId("nda-edit-title")).toHaveText("Edit NDA-902");
  await expect(page.getByLabel("Contact email")).toHaveValue("person@example.com");
  await expect(page.getByLabel("Contact phone")).toHaveValue("ext 4");
});

test("a queue row opens that dossier and the actions menu closes", async ({ page }) => {
  const other = { ...row, nda_id: "NDA-903", counterparty_firm: "Other Firm", conflict: "", gmail_thread_ids: [] };
  await page.route("**/api/data/nda", (route) => route.fulfill({ json: { source: "fixture", as_of: "2026-11-23", label: "Sample", queue: [row, other] } }));
  await page.route("**/api/actions/accounts", (route) => route.fulfill({ json: { accounts: [] } }));
  await page.goto("/?nda=1", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("nda-cards")).toBeVisible();
  await page.getByRole("button", { name: "NDA actions" }).click();
  await expect(page.getByTestId("nda-export")).toBeVisible();
  await page.getByRole("tab", { name: /All/ }).click();
  await expect(page.getByTestId("nda-export")).toBeHidden();
  await page.getByRole("button", { name: "NDA actions" }).click();
  await expect(page.getByTestId("nda-export")).toBeVisible();
  await page.getByTestId("nda-card-NDA-902").click();
  await expect(page.getByTestId("nda-detail")).toBeVisible();
  await expect(page.getByTestId("nda-detail")).toContainText("Sample Firm");
  await expect(page.getByTestId("nda-export")).toBeHidden();
  await expect(page).toHaveURL(/nda=NDA-902/);
  await page.getByTestId("nda-back").click();
  await page.getByTestId("nda-card-NDA-903").click();
  await expect(page.getByTestId("nda-detail")).toContainText("Other Firm");
  await expect(page.getByTestId("nda-cards")).toBeHidden();
});
