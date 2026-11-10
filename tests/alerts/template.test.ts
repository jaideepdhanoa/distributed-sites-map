import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderAlert } from "../../lib/alerts/template";
import type { MailItem } from "../../lib/alerts/compose";
import { discussionHref, homeHref, mailLink, proposalHref, reviewHref, settingsHref } from "../../lib/alerts/links";

const NOW = new Date("2026-11-09T16:00:00.000Z");

function item(category: MailItem["category"], summary: string): MailItem {
  return {
    category,
    siteId: "sample",
    siteLabel: "Sample site",
    summary,
    authorId: "Ana",
    href: category === "approvals" || category === "assignments" ? proposalHref("sample") : category === "flags" ? reviewHref("sample") : discussionHref("sample"),
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
  const cases: { name: string; category: MailItem["category"]; summary: string; subject: string; button: string; href: string }[] = [
    { name: "approval", category: "approvals", summary: "Please review the next step on this sample site.", subject: "Approval needed: Sample site (PHX)", button: "Open the proposal", href: proposalHref("sample") },
    { name: "mention", category: "mentions", summary: "Please take a look at this sample note.", subject: "Ana mentioned you on Sample site", button: "Reply in Discussion", href: discussionHref("sample") },
    { name: "reply", category: "replies", summary: "Adding a sample reply on the thread.", subject: "Ana replied on Sample site", button: "Reply in Discussion", href: discussionHref("sample") },
    { name: "flag", category: "flags", summary: "Flagging this sample site for a closer look.", subject: "Ana flagged Sample site for you", button: "Open in Review", href: reviewHref("sample") },
    { name: "assignment", category: "assignments", summary: "This sample site is assigned to you.", subject: "Ana assigned Sample site to you", button: "Open the proposal", href: proposalHref("sample") },
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
      assert.equal(rendered.html.includes(`href="${entry.href.replace(/&/g, "&amp;")}"`), true);
      assert.equal(rendered.body.includes(entry.href), true);
      assert.equal(rendered.body.includes("preview."), false);
      assert.equal(rendered.html.includes("preview."), false);
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
    assert.equal(digest.html.includes(proposalHref("sample").replace(/&/g, "&amp;")), true);
    assert.equal(digest.html.includes(discussionHref("sample").replace(/&/g, "&amp;")), true);
    assert.equal(digest.html.includes(reviewHref("sample").replace(/&/g, "&amp;")), true);
    assert.equal(digest.body.includes(proposalHref("sample")), true);
    assert.equal(digest.body.includes(discussionHref("sample")), true);
    assert.equal(digest.body.includes(reviewHref("sample")), true);
    const portfolio = renderAlert([{ ...item("mentions", "A note on the whole book."), siteId: "portfolio", siteLabel: "Portfolio", href: "https://preview.distributedsites.com/" }], { now: NOW, kind: "instant" });
    assert.ok(portfolio);
    assert.equal(portfolio.html.includes(`href="${homeHref()}"`), true);
    assert.equal(portfolio.body.includes(homeHref()), true);
    assert.equal(portfolio.html.includes("preview."), false);
    assert.equal(mailLink({ category: "approvals", siteId: "PIPE-PHX-0008", href: "https://preview.distributedsites.com/?view=review&site=PIPE-PHX-0008" }), proposalHref("PIPE-PHX-0008"));
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
