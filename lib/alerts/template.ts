import { findPolicyHits, safeSnapshot } from "@/lib/policy/banned";
import { EXCLUDED_SITE_ID, isExcludedSite } from "./excluded";
import { mailLink, reviewHomeHref, settingsHref } from "./links";
import { authorName, categoryLabel, publicSnippet, screenEmail, type MailItem } from "./compose";

const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const SERIF = "Georgia, 'Times New Roman', Times, serif";

const SECTIONS: { title: string; categories: MailItem["category"][] }[] = [
  { title: "Waiting on you", categories: ["recommendations", "proposals", "decisions", "asks"] },
  { title: "Stage changes", categories: ["stages"] },
  { title: "New listings", categories: ["sites"] },
  { title: "Inbound replies", categories: ["comms"] },
  { title: "Needs your approval", categories: ["approvals"] },
  { title: "Mentions & replies", categories: ["mentions", "comments", "replies", "followed"] },
  { title: "Assigned to you", categories: ["assignments"] },
  { title: "Flags", categories: ["flags"] },
];

export type RenderedMail = { subject: string; body: string; html: string };

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function clean(value: string, max = 180): string {
  const text = publicSnippet(value) || safeSnapshot(value, max);
  if (!text || findPolicyHits(text)) return "";
  return text;
}

function siteName(item: MailItem): string {
  const label = clean(item.siteLabel || item.siteId, 120) || clean(item.siteId, 80);
  if (!label || isExcludedSite(label)) return "";
  return label.replace(/\s*\([^)]*\)\s*$/, "").trim() || label;
}

/** A count or portfolio line has no site. It is not a place on the map. */
function summaryRow(item: MailItem): boolean {
  return !item.siteId.trim();
}

function quarantined(item: MailItem): boolean {
  const blob = `${item.siteId} ${item.siteLabel} ${item.href} ${item.summary}`.toUpperCase();
  return blob.includes(EXCLUDED_SITE_ID);
}

function siteIdLine(item: MailItem, name: string): string {
  const id = clean(item.siteId, 80);
  if (!id || id === name || id.toLowerCase() === "portfolio" || isExcludedSite(id)) return "";
  return id;
}

function whoLabel(authorId: string, recipientId?: string): string {
  const id = authorId.trim();
  if (!id) return "";
  if (recipientId && id.toLowerCase() === recipientId.trim().toLowerCase()) return "";
  return authorName(id);
}

function marketCode(item: MailItem): string {
  return clean(item.market || "", 12).toUpperCase();
}

function stageName(item: MailItem): string {
  return clean(item.stage || "", 40);
}

export function instantSubject(item: MailItem, recipientId?: string): string {
  const name = siteName(item) || "Review";
  const who = whoLabel(item.authorId, recipientId);
  const market = marketCode(item);
  if (item.category === "approvals") return market ? `Approval needed: ${name} (${market})` : `Approval needed: ${name}`;
  if (item.category === "mentions") return who ? `${who} mentioned you on ${name}` : `Mention on ${name}`;
  if (item.category === "replies") return who ? `${who} replied on ${name}` : `Reply on ${name}`;
  if (item.category === "flags") return who ? `${who} flagged ${name} for you` : `Flag on ${name}`;
  if (item.category === "assignments") return who ? `${who} assigned ${name} to you` : `Assignment on ${name}`;
  if (item.category === "recommendations") return who ? `${who} left a recommendation on ${name}` : `Recommendation on ${name}`;
  if (item.category === "proposals") return market ? `Proposal waiting: ${name} (${market})` : `Proposal waiting: ${name}`;
  if (item.category === "decisions") return market ? `Decision needed: ${name} (${market})` : `Decision needed: ${name}`;
  if (item.category === "stages") return market ? `Stage change: ${name} (${market})` : `Stage change: ${name}`;
  return `${categoryLabel(item.category)}: ${name}`;
}

export function digestSubject(items: MailItem[], now: Date): string {
  const count = items.filter((item) => item.category !== "queue" && item.category !== "brief").length;
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(now).replace(/,/g, "");
  if (!count) {
    const review = items.find((item) => item.category === "queue");
    if (review && !/^Nothing\b/.test(review.summary)) return `Distributed Sites daily digest · ${date} · Review`;
    return `Distributed Sites daily digest · ${date} · Quiet`;
  }
  const noun = count === 1 ? "item" : "items";
  return `Distributed Sites daily digest · ${date} · ${count} ${noun}`;
}

export function updatesSubject(count: number): string {
  const noun = count === 1 ? "update" : "updates";
  return `Distributed Sites · ${count} ${noun}`;
}

export function catchUpSubject(count: number): string {
  const noun = count === 1 ? "update" : "updates";
  return `Distributed Sites catch-up · ${count} ${noun}`;
}

function actionLine(item: MailItem, recipientId?: string): string {
  const who = whoLabel(item.authorId, recipientId);
  if (!who || summaryRow(item)) return "";
  if (item.category === "approvals") return `${who} asked you to approve a next step.`;
  if (item.category === "mentions") return `${who} mentioned you.`;
  if (item.category === "comments") return `${who} commented.`;
  if (item.category === "replies") return `${who} replied.`;
  if (item.category === "flags") return `${who} flagged this for you.`;
  if (item.category === "assignments") return `${who} assigned this to you.`;
  if (item.category === "recommendations") return `${who} left a recommendation.`;
  if (item.category === "proposals") return `${who} sent a proposal.`;
  if (item.category === "decisions") return `${who} asked for a decision.`;
  if (item.category === "stages") return `${who} changed the stage.`;
  if (item.category === "activity" || item.category === "comms" || item.category === "brief" || item.category === "queue" || item.category === "asks") return "";
  return `${who} added a note.`;
}

function whyLine(category: MailItem["category"] | "digest" | "updates" | "catchup"): string {
  if (category === "approvals") return "You received this because an approval is waiting on you.";
  if (category === "mentions") return "You received this because someone mentioned you.";
  if (category === "comments") return "You received this because you follow this site.";
  if (category === "replies") return "You received this because someone replied on a thread you are part of.";
  if (category === "flags") return "You received this because someone flagged a site for you.";
  if (category === "assignments") return "You received this because a site was assigned to you.";
  if (category === "recommendations") return "You received this because an agent left a recommendation for you.";
  if (category === "proposals") return "You received this because a proposal is waiting on you.";
  if (category === "decisions") return "You received this because a decision is waiting on you.";
  if (category === "stages") return "You received this because an agent changed a stage.";
  if (category === "updates") return "You received this because several updates arrived together.";
  if (category === "catchup") return "You received this because these updates were waiting to be sent.";
  return "You received this because it is your daily digest.";
}

function buttonLabel(item: MailItem): string {
  if (!item.siteId.trim()) return "Review";
  if (item.siteId === "portfolio") return "Open the map";
  if (item.category === "approvals" || item.category === "assignments" || item.category === "proposals") return "Open the proposal";
  if (item.category === "decisions" && item.href && !/[?&]panel=proposal(?:&|$)/.test(item.href)) return "Open the site";
  if (item.category === "decisions") return "Open the proposal";
  if (item.category === "recommendations") return "Open the recommendation";
  if (item.category === "stages" || item.category === "activity" || item.category === "comms") return "Open the site";
  if (item.category === "flags") return "Open in Review";
  if (item.category === "comments") return "Open comment";
  if (item.category === "mentions" || item.category === "replies" || item.category === "followed") return "Reply in Discussion";
  return "Open in Review";
}

function button(label: string, href: string): string {
  const url = esc(href);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#1e4636" style="background:#1e4636;border-radius:999px;">
<a href="${url}" style="display:inline-block;padding:12px 22px;font-family:${SANS};font-size:14px;font-weight:650;line-height:1.2;color:#fffdf8;text-decoration:none;">${esc(label)}</a>
</td></tr></table>`;
}

function textLink(label: string, href: string): string {
  return `<a href="${esc(href)}" style="color:#1e4636;text-decoration:underline;text-decoration-color:rgba(30,70,54,0.35);text-underline-offset:3px;">${esc(label)}</a>`;
}

function shell(bodyRows: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Distributed Sites</title>
</head>
<body style="margin:0;padding:0;background:#e7e0d2;color:#1c1914;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#e7e0d2" style="background:#e7e0d2;width:100%;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#fffdf8" style="width:100%;max-width:600px;background:#fffdf8;border-radius:16px;">
<tr><td style="padding:24px 28px 8px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="32" height="32" bgcolor="#1e4636" align="center" valign="middle" style="width:32px;height:32px;background:#1e4636;border-radius:10px;font-family:${SERIF};font-size:13px;font-weight:650;color:#fffdf8;line-height:32px;">DS</td>
<td style="padding-left:10px;font-family:${SERIF};font-size:20px;line-height:1.1;color:#1c1914;">Distributed Sites</td>
</tr></table>
</td></tr>
${bodyRows}
</table>
</td></tr>
</table>
</body>
</html>`;
}

function eyebrow(text: string): string {
  return `<tr><td style="padding:12px 28px 0;font-family:${SANS};font-size:12px;line-height:1.3;letter-spacing:0.06em;text-transform:uppercase;color:#8a8273;">${esc(text)}</td></tr>`;
}

function footer(why: string, settingsHref: string): string {
  return `<tr><td style="padding:8px 28px 28px;font-family:${SANS};font-size:12px;line-height:1.45;color:#8a8273;">
${textLink("Manage alert settings", settingsHref)}
<p style="margin:8px 0 0;font-family:${SANS};font-size:12px;line-height:1.45;color:#8a8273;">${esc(why)}</p>
</td></tr>`;
}

function summaryBlock(item: MailItem, recipientId?: string): { html: string; text: string[] } {
  if (quarantined(item)) return { html: "", text: [] };
  const quote = clean(item.summary, 180);
  if (summaryRow(item)) {
    const lines = quote ? [quote] : [];
    const html = quote
      ? `<tr><td style="padding:8px 28px 0;font-family:${SANS};font-size:16px;line-height:1.45;color:#1c1914;">${esc(quote)}</td></tr>`
      : "";
    return { html, text: lines };
  }
  const name = siteName(item) || "Review";
  const id = siteIdLine(item, name);
  const market = marketCode(item);
  const stage = stageName(item);
  const meta = [market, stage].filter(Boolean).join(" · ");
  const who = clean(actionLine(item, recipientId), 160);
  const lines = [name];
  if (id) lines.push(id);
  if (meta) lines.push(meta);
  if (who) lines.push(who);
  if (quote) lines.push(`“${quote}”`);
  const html = `<tr><td style="padding:8px 28px 0;font-family:${SERIF};font-size:28px;line-height:1.15;color:#1c1914;">${esc(name)}</td></tr>
${id ? `<tr><td style="padding:4px 28px 0;font-family:${SANS};font-size:14px;line-height:1.4;color:#5b554b;">${esc(id)}</td></tr>` : ""}
${meta ? `<tr><td style="padding:4px 28px 0;font-family:${SANS};font-size:14px;line-height:1.4;color:#5b554b;">${esc(meta)}</td></tr>` : ""}
${who ? `<tr><td style="padding:12px 28px 0;font-family:${SANS};font-size:16px;line-height:1.45;color:#1c1914;">${esc(who)}</td></tr>` : ""}
${quote ? `<tr><td style="padding:12px 28px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-left:3px solid #d6cebe;padding:4px 0 4px 12px;font-family:${SANS};font-size:16px;line-height:1.45;color:#1c1914;">“${esc(quote)}”</td></tr></table></td></tr>` : ""}`;
  return { html, text: lines };
}

function renderInstant(item: MailItem, settingsHref: string, recipientId?: string): { subject: string; text: string; rows: string } {
  const block = summaryBlock(item, recipientId);
  const label = buttonLabel(item);
  const href = mailLink(item);
  const text = [
    "Distributed Sites",
    "",
    categoryLabel(item.category),
    ...block.text,
    "",
    label,
    href,
    "",
    "Manage alert settings",
    whyLine(item.category),
  ].join("\n");
  const rows = [
    eyebrow(categoryLabel(item.category)),
    block.html,
    `<tr><td style="padding:20px 28px 8px;">${button(label, href)}</td></tr>`,
    footer(whyLine(item.category), settingsHref),
  ].join("\n");
  return { subject: instantSubject(item, recipientId), text, rows };
}

function summaryLine(item: MailItem): { text: string; html: string } | null {
  const quote = clean(item.summary, 180);
  if (!quote) return null;
  return {
    text: quote,
    html: `<tr><td style="padding:8px 28px 0;font-family:${SANS};font-size:16px;line-height:1.45;color:#1c1914;">${esc(quote)}</td></tr>`,
  };
}

function appendSummary(item: MailItem, textLines: string[], html: string[]): void {
  if (quarantined(item)) return;
  const line = summaryLine(item);
  if (!line) return;
  textLines.push(line.text);
  html.push(line.html);
}

function appendSite(item: MailItem, textLines: string[], html: string[], recipientId?: string): void {
  if (quarantined(item)) return;
  const name = siteName(item);
  if (!name) return;
  const href = mailLink(item);
  const id = siteIdLine(item, name);
  const meta = [marketCode(item), stageName(item), clean(actionLine(item, recipientId), 120)].filter(Boolean).join(" · ");
  const quote = clean(item.summary, 140);
  textLines.push(name);
  if (id) textLines.push(id);
  textLines.push(href);
  if (meta) textLines.push(meta);
  if (quote) textLines.push(`“${quote}”`);
  html.push(`<tr><td style="padding:8px 28px 0;font-family:${SANS};font-size:16px;line-height:1.4;color:#1c1914;">${textLink(name, href)}</td></tr>`);
  if (id) html.push(`<tr><td style="padding:2px 28px 0;font-family:${SANS};font-size:14px;line-height:1.4;color:#5b554b;">${esc(id)}</td></tr>`);
  if (meta) html.push(`<tr><td style="padding:2px 28px 0;font-family:${SANS};font-size:14px;line-height:1.4;color:#5b554b;">${esc(meta)}</td></tr>`);
  if (quote) html.push(`<tr><td style="padding:2px 28px 8px;font-family:${SANS};font-size:14px;line-height:1.4;color:#1c1914;">“${esc(quote)}”</td></tr>`);
}

type BatchTone = "digest" | "updates" | "catchup";

function batchHeading(tone: BatchTone): string {
  if (tone === "catchup") return "Catch-up";
  if (tone === "updates") return "Updates";
  return "Daily digest";
}

function batchSubject(items: MailItem[], now: Date, tone: BatchTone): string {
  const count = items.filter((item) => item.category !== "queue" && item.category !== "brief").length;
  if (tone === "catchup") return catchUpSubject(count);
  if (tone === "updates") return updatesSubject(count);
  return digestSubject(items, now);
}

function renderGrouped(items: MailItem[], settingsHref: string, recipientId?: string): { subject: string; text: string; rows: string } {
  const home = reviewHomeHref();
  const content = items.filter((item) => item.category !== "queue" && item.category !== "brief");
  const textLines = ["Distributed Sites", "", "Updates"];
  const html: string[] = [eyebrow("Updates")];
  const groups = new Map<string, MailItem[]>();
  for (const item of content) {
    const key = item.siteId.trim() || "portfolio";
    const list = groups.get(key) || [];
    list.push(item);
    groups.set(key, list);
  }
  for (const [key, group] of groups) {
    if (key === "portfolio") {
      textLines.push("");
      for (const item of group) appendSummary(item, textLines, html);
      continue;
    }
    const head = group.find((item) => !quarantined(item));
    if (!head) continue;
    const name = siteName(head);
    if (!name) continue;
    const href = mailLink(head);
    const id = siteIdLine(head, name);
    textLines.push("", name);
    if (id) textLines.push(id);
    textLines.push(href);
    html.push(`<tr><td style="padding:8px 28px 0;font-family:${SANS};font-size:16px;line-height:1.4;color:#1c1914;">${textLink(name, href)}</td></tr>`);
    if (id) html.push(`<tr><td style="padding:2px 28px 0;font-family:${SANS};font-size:14px;line-height:1.4;color:#5b554b;">${esc(id)}</td></tr>`);
    for (const item of group) {
      const quote = clean(item.summary, 140);
      const meta = [categoryLabel(item.category), clean(actionLine(item, recipientId), 120)].filter(Boolean).join(" · ");
      if (meta) textLines.push(meta);
      if (quote) textLines.push(`“${quote}”`);
      if (meta) html.push(`<tr><td style="padding:2px 28px 0;font-family:${SANS};font-size:14px;line-height:1.4;color:#5b554b;">${esc(meta)}</td></tr>`);
      if (quote) html.push(`<tr><td style="padding:2px 28px 8px;font-family:${SANS};font-size:14px;line-height:1.4;color:#1c1914;">“${esc(quote)}”</td></tr>`);
    }
  }
  textLines.push("", "Open Review", home, "", "Manage alert settings", whyLine("updates"));
  html.push(`<tr><td style="padding:20px 28px 8px;">${button("Open Review", home)}</td></tr>`);
  html.push(footer(whyLine("updates"), settingsHref));
  return { subject: updatesSubject(content.length), text: textLines.join("\n"), rows: html.join("\n") };
}

function renderDigest(items: MailItem[], now: Date, settingsHref: string, tone: BatchTone = "digest", recipientId?: string): { subject: string; text: string; rows: string } {
  if (tone === "updates") return renderGrouped(items, settingsHref, recipientId);
  const home = reviewHomeHref();
  const heading = batchHeading(tone);
  const textLines = ["Distributed Sites", "", heading];
  const html: string[] = [eyebrow(heading)];
  for (const item of items.filter((row) => row.category === "queue" || row.category === "brief")) {
    const line = clean(item.summary, 180) || "Waiting in Review.";
    textLines.push(line);
    html.push(`<tr><td style="padding:8px 28px 0;font-family:${SANS};font-size:16px;line-height:1.45;color:#1c1914;">${esc(line)}</td></tr>`);
  }
  for (const section of SECTIONS) {
    const rows = items.filter((item) => section.categories.includes(item.category) && !quarantined(item));
    if (!rows.length) continue;
    textLines.push("", `${section.title} (${rows.length})`);
    html.push(eyebrow(`${section.title} · ${rows.length}`));
    for (const item of rows.filter(summaryRow)) appendSummary(item, textLines, html);
    for (const item of rows.filter((row) => !summaryRow(row))) appendSite(item, textLines, html, recipientId);
  }
  textLines.push("", "Open Review", home, "", "Manage alert settings", whyLine(tone));
  html.push(`<tr><td style="padding:20px 28px 8px;">${button("Open Review", home)}</td></tr>`);
  html.push(footer(whyLine(tone), settingsHref));
  return { subject: batchSubject(items, now, tone), text: textLines.join("\n"), rows: html.join("\n") };
}

export type AlertKind = "instant" | "digest" | "updates" | "catchup";

export function renderAlert(items: MailItem[], options?: { now?: Date; kind?: AlertKind; settingsHref?: string; recipientId?: string }): RenderedMail | null {
  const content = items.filter((item) => item.category !== "queue" && item.category !== "brief");
  const framed = items.some((item) => item.category === "queue" || item.category === "brief");
  if (!content.length && !framed) return null;
  const now = options?.now || new Date();
  const settings = options?.settingsHref || settingsHref();
  const recipientId = options?.recipientId;
  const tone: BatchTone = options?.kind === "digest" || options?.kind === "updates" || options?.kind === "catchup" ? options.kind : "updates";
  const oneInstant = options?.kind !== "digest" && options?.kind !== "updates" && options?.kind !== "catchup" && content.length === 1 && !framed;
  const rendered = oneInstant ? renderInstant(content[0], settings, recipientId) : renderDigest(items, now, settings, tone, recipientId);
  const screened = screenEmail(rendered.subject, rendered.text);
  if (!screened) return null;
  return { subject: screened.subject, body: screened.body, html: shell(rendered.rows) };
}
