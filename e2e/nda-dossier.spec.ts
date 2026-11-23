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
