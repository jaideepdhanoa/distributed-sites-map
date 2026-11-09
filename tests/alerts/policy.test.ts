import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { publicSnippet, renderBatch, screenEmail } from "../../lib/alerts/compose";
import { findPolicyHits } from "../../lib/policy/banned";
import { discussionHref, reviewHref, appOrigin } from "../../lib/alerts/links";
import { DEFAULT_FROM, alertFrom, alertReplyTo, transportKind } from "../../lib/alerts/transport";

function blockedWord(): string {
  const file = JSON.parse(readFileSync("config/display-policy.json", "utf8")) as { words: string[] };
  const word = file.words
    .map((item) => Buffer.from(item, "base64").toString("utf8").replace(/^term:/, ""))
    .find((item) => item.length >= 6);
  if (!word) throw new Error("missing term");
  return word;
}

test("email subject and body drop banned wording, links, and figures", () => {
  const word = blockedWord();
  const rendered = renderBatch([
    {
      category: "mentions",
      siteId: "PIPE-PHX-0008",
      siteLabel: "Sample deal (PIPE-PHX-0008)",
      summary: `Please look at the frontage and the ${word}. Package https://example.com/file and $1,600,000.`,
      authorId: "contributor",
      href: "/?site=PIPE-PHX-0008&panel=discussion",
    },
  ]);
  assert.ok(rendered);
  assert.equal(findPolicyHits(rendered.subject), 0);
  assert.equal(findPolicyHits(rendered.body), 0);
  assert.equal(rendered.body.includes(word), false);
  assert.equal(rendered.body.includes("https://"), false);
  assert.equal(rendered.body.includes("$"), false);
  assert.equal(rendered.body.includes("PIPE-PHX-0008"), true);
  assert.equal(screenEmail(`Update ${word}`, "A clean note.").subject, "Review update");
  assert.equal(publicSnippet("See https://files.example/pack and $20").includes("https"), false);
});

test("Resend is preferred, Gmail is the fallback, and the from-address is the verified domain", () => {
  const previous = {
    key: process.env.RESEND_API_KEY,
    domain: process.env.RESEND_EMAIL_DOMAIN,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.ALERT_FROM,
    reply: process.env.ALERT_REPLY_TO,
  };
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_EMAIL_DOMAIN;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.ALERT_FROM;
  delete process.env.ALERT_REPLY_TO;
  assert.equal(transportKind(), null);
  assert.equal(alertFrom(), DEFAULT_FROM);
  process.env.RESEND_EMAIL_DOMAIN = "distributedsites.com";
  assert.equal(alertFrom(), "Distributed Sites <alerts@distributedsites.com>");
  delete process.env.RESEND_EMAIL_DOMAIN;
  assert.equal(alertReplyTo(), "jaideep@dhanoa.in");
  process.env.SMTP_USER = "jaideep@dhanoa.in";
  process.env.SMTP_PASS = "app-password";
  assert.equal(transportKind(), "smtp");
  assert.equal(alertFrom(), "jaideep@dhanoa.in");
  process.env.RESEND_API_KEY = "re_test";
  process.env.ALERT_FROM = DEFAULT_FROM;
  process.env.ALERT_REPLY_TO = "jaideep@dhanoa.in";
  assert.equal(transportKind(), "resend");
  assert.equal(alertFrom(), "Distributed Sites <alerts@distributedsites.com>");
  assert.equal(alertReplyTo(), "jaideep@dhanoa.in");
  for (const [name, value] of Object.entries(previous)) {
    const key = name === "key" ? "RESEND_API_KEY" : name === "domain" ? "RESEND_EMAIL_DOMAIN" : name === "user" ? "SMTP_USER" : name === "pass" ? "SMTP_PASS" : name === "from" ? "ALERT_FROM" : "ALERT_REPLY_TO";
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
});

test("email links use APP_URL and default to https://distributedsites.com", () => {
  const previous = process.env.APP_URL;
  delete process.env.APP_URL;
  assert.equal(appOrigin(), "https://distributedsites.com");
  assert.equal(discussionHref("PIPE-PHX-0008"), "https://distributedsites.com/?site=PIPE-PHX-0008&panel=discussion");
  assert.equal(reviewHref("PIPE-LAS-0016"), "https://distributedsites.com/?view=review&site=PIPE-LAS-0016");
  process.env.APP_URL = "https://preview.example/";
  assert.equal(appOrigin(), "https://preview.example");
  if (previous == null) delete process.env.APP_URL;
  else process.env.APP_URL = previous;
});
