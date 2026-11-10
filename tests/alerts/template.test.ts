import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderAlert } from "../../lib/alerts/template";
import type { MailItem } from "../../lib/alerts/compose";
import { discussionHref, reviewHref, settingsHref } from "../../lib/alerts/links";

const NOW = new Date("2026-11-09T16:00:00.000Z");

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

function visible(html: string): string {
  return html
    .replace(/<a\b[^>]*href="[^"]*"[^>]*>/gi, "<a>")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const samples: { name: string; mail: NonNullable<ReturnType<typeof renderAlert>> }[] = [];

test("instant templates name the event and hide raw links", () => {
  const previous = process.env.APP_URL;
  process.env.APP_URL = "https://distributedsites.com";
  const cases: { name: string; category: MailItem["category"]; summary: string; subject: string; button: string }[] = [
    { name: "approval", category: "approvals", summary: "Please review the next step on this sample site.", subject: "Approval needed: Sample site (PHX)", button: "Open in Review" },
    { name: "mention", category: "mentions", summary: "Please take a look at this sample note.", subject: "Ana mentioned you on Sample site", button: "Reply in Discussion" },
    { name: "reply", category: "replies", summary: "Adding a sample reply on the thread.", subject: "Ana replied on Sample site", button: "Reply in Discussion" },
    { name: "flag", category: "flags", summary: "Flagging this sample site for a closer look.", subject: "Ana flagged Sample site for you", button: "Open in Review" },
    { name: "assignment", category: "assignments", summary: "This sample site is assigned to you.", subject: "Ana assigned Sample site to you", button: "Open in Review" },
  ];
  try {
    for (const entry of cases) {
      const rendered = renderAlert([item(entry.category, entry.summary)], { now: NOW, kind: "instant" });
      assert.ok(rendered);
      assert.equal(rendered.subject, entry.subject);
      assert.match(rendered.html, new RegExp(entry.button));
      assert.match(rendered.html, /max-width:600px/);
      assert.match(rendered.html, /#fffdf8/);
      assert.match(rendered.html, /#1e4636/);
      assert.match(rendered.html, /#e7e0d2/);
      assert.match(rendered.html, /Manage alert settings/);
      assert.equal(visible(rendered.html).includes("http"), false);
      assert.equal(rendered.body.includes("http"), false);
      assert.equal(rendered.html.includes(settingsHref()), true);
      samples.push({ name: entry.name, mail: rendered });
    }
    const digest = renderAlert(cases.map((entry) => item(entry.category, entry.summary)), { now: NOW, kind: "digest" });
    assert.ok(digest);
    assert.equal(digest.subject, "Distributed Sites daily digest · Mon Nov 9 · 5 items");
    assert.match(digest.html, /Needs your approval · 1/);
    assert.match(digest.html, /Mentions &amp; replies · 2/);
    assert.match(digest.html, /Assigned to you · 1/);
    assert.match(digest.html, /Flags · 1/);
    assert.match(digest.html, /Open Review/);
    assert.equal(visible(digest.html).includes("http"), false);
    samples.push({ name: "digest", mail: digest });
    for (const sample of samples) {
      const expected = readFileSync(new URL(`./snapshots/${sample.name}.html`, import.meta.url), "utf8");
      assert.equal(sample.mail.html, expected);
    }
  } finally {
    if (previous == null) delete process.env.APP_URL;
    else process.env.APP_URL = previous;
  }
});
