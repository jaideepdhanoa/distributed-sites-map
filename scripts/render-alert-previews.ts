import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { renderAlert } from "../lib/alerts/template";
import type { MailItem } from "../lib/alerts/compose";
import { discussionHref, reviewHref } from "../lib/alerts/links";

const now = new Date("2026-11-09T16:00:00.000Z");

function item(category: MailItem["category"], summary: string): MailItem {
  return {
    category,
    siteId: "sample",
    siteLabel: "Sample site",
    summary,
    authorId: "Ana",
    href: category === "mentions" || category === "replies" ? discussionHref("sample") : reviewHref("sample"),
    market: "PHX",
    stage: "Desk screen",
  };
}

const cases = [
  ["approval", "approvals", "Please review the next step on this sample site."],
  ["mention", "mentions", "Please take a look at this sample note."],
  ["reply", "replies", "Adding a sample reply on the thread."],
  ["flag", "flags", "Flagging this sample site for a closer look."],
  ["assignment", "assignments", "This sample site is assigned to you."],
] as const;

async function main() {
  process.env.APP_URL = "https://distributedsites.com";
  const out = "/opt/cursor/artifacts";
  const htmlDir = "/tmp/alert-previews";
  mkdirSync(out, { recursive: true });
  mkdirSync(htmlDir, { recursive: true });
  const browser = await chromium.launch();
  const pages = cases.map(([name, category, summary]) => {
    const mail = renderAlert([item(category, summary)], { now, kind: "instant" });
    if (!mail) throw new Error(`missing ${name}`);
    return { name, html: mail.html };
  });
  const digest = renderAlert(cases.map(([, category, summary]) => item(category, summary)), { now, kind: "digest" });
  if (!digest) throw new Error("missing digest");
  pages.push({ name: "digest", html: digest.html });
  for (const page of pages) {
    writeFileSync(`${htmlDir}/${page.name}.html`, page.html);
    for (const [label, width] of [["desktop", 640], ["mobile", 390]] as const) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const view = await context.newPage();
      await view.setContent(page.html, { waitUntil: "load" });
      await view.screenshot({ path: `${out}/alert-${page.name}-${label}.png`, fullPage: true });
      await context.close();
    }
  }
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
