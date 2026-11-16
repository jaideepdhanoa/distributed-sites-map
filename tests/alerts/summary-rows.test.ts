import assert from "node:assert/strict";
import test from "node:test";
import type { MailItem } from "../../lib/alerts/compose";
import { proposalHref, reviewHomeHref, siteHref } from "../../lib/alerts/links";
import { renderAlert } from "../../lib/alerts/template";

const NOW = new Date("2026-11-15T16:00:00.000Z");
const HASH = "$2b$04$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuuabcdefghijk";

function visible(html: string): string {
  return html
    .replace(/<a\b[^>]*href="[^"]*"[^>]*>/gi, "<a>")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

test("summary rows are plain sentences and site rows keep a name, id, and deeplink", () => {
  const previousUsers = process.env.AUTH_USERS;
  const previousUrl = process.env.APP_URL;
  process.env.AUTH_USERS = JSON.stringify([
    { u: "cindel", h: HASH, role: "user", name: "Cindel" },
    { u: "jaideep", h: HASH, role: "admin", name: "Jaideep" },
  ]);
  process.env.APP_URL = "https://distributedsites.com";
  const review = reviewHomeHref();
  const proposal = proposalHref("PIPE-PHX-0100");
  const stage = siteHref("PIPE-PHX-0104");
  const items: MailItem[] = [
    {
      category: "recommendations",
      siteId: "",
      siteLabel: "",
      summary: "2 agent draft replies are waiting for you.",
      authorId: "jaideep",
      href: review,
    },
    {
      category: "asks",
      siteId: "",
      siteLabel: "",
      summary: "1 open ask gap.",
      authorId: "jaideep",
      href: review,
    },
    {
      category: "proposals",
      siteId: "PIPE-PHX-0100",
      siteLabel: "North lot (PIPE-PHX-0100)",
      summary: "Sample proposal headline.",
      authorId: "cindel",
      href: proposal,
    },
    {
      category: "stages",
      siteId: "PIPE-PHX-0104",
      siteLabel: "South lot (PIPE-PHX-0104)",
      summary: "Stage updated.",
      authorId: "jaideep",
      href: stage,
    },
    {
      category: "proposals",
      siteId: "PIPE-PHX-0006",
      siteLabel: "Protected (PIPE-PHX-0006)",
      summary: "Hidden proposal headline.",
      authorId: "cindel",
      href: proposalHref("PIPE-PHX-0006"),
    },
  ];
  try {
    const rendered = renderAlert(items, { now: NOW, kind: "catchup", recipientId: "jaideep" });
    assert.ok(rendered);
    assert.match(rendered.body, /2 agent draft replies are waiting for you\./);
    assert.match(rendered.body, /1 open ask gap\./);
    assert.equal(rendered.body.includes("“2 agent draft replies"), false);
    assert.equal(rendered.body.includes("“1 open ask gap"), false);
    assert.equal(rendered.body.split("\n").includes("Site"), false);
    assert.equal(rendered.html.includes(">Site<"), false);
    assert.equal(rendered.body.toLowerCase().includes("jaideep"), false);
    assert.equal(rendered.html.toLowerCase().includes("jaideep"), false);
    assert.equal(rendered.body.includes("left a recommendation"), false);
    assert.equal(rendered.body.includes("added a note"), false);
    assert.equal(rendered.body.split(review).length - 1, 1);
    assert.equal(rendered.html.split(review).length - 1, 1);
    assert.match(rendered.body, /North lot/);
    assert.match(rendered.body, /PIPE-PHX-0100/);
    assert.match(rendered.body, /Cindel sent a proposal\./);
    assert.match(rendered.body, /Sample proposal headline\./);
    assert.equal(rendered.body.includes(proposal), true);
    assert.equal(rendered.html.includes(proposal.replace(/&/g, "&amp;")), true);
    assert.match(rendered.body, /South lot/);
    assert.match(rendered.body, /PIPE-PHX-0104/);
    assert.equal(rendered.body.includes(stage), true);
    assert.equal(rendered.body.includes("changed the stage"), false);
    assert.equal(rendered.body.includes("PIPE-PHX-0006"), false);
    assert.equal(rendered.html.includes("PIPE-PHX-0006"), false);
    assert.equal(rendered.body.includes("Hidden proposal"), false);
    assert.equal(visible(rendered.html).includes("http"), false);
    assert.match(visible(rendered.html), /2 agent draft replies are waiting for you/);
    assert.match(visible(rendered.html), /1 open ask gap/);
    assert.match(visible(rendered.html), /North lot/);
    assert.match(visible(rendered.html), /PIPE-PHX-0100/);
    assert.match(visible(rendered.html), /Cindel sent a proposal/);
  } finally {
    if (previousUsers == null) delete process.env.AUTH_USERS;
    else process.env.AUTH_USERS = previousUsers;
    if (previousUrl == null) delete process.env.APP_URL;
    else process.env.APP_URL = previousUrl;
  }
});
