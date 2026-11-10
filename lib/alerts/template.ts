import { findPolicyHits, safeSnapshot } from "@/lib/policy/banned";
import { reviewHomeHref, settingsHref } from "./links";
import { authorName, categoryLabel, publicSnippet, screenEmail, type MailItem } from "./compose";

const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const SERIF = "Georgia, 'Times New Roman', Times, serif";

const SECTIONS: { title: string; categories: MailItem["category"][] }[] = [
  { title: "Needs your approval", categories: ["approvals"] },
  { title: "Mentions & replies", categories: ["mentions", "replies", "followed"] },
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
  if (/offer|walk-away|walk away|max[- ]pay/i.test(text)) return "";
  return text;
}

function siteName(item: MailItem): string {
  const label = clean(item.siteLabel || item.siteId, 120) || clean(item.siteId, 80) || "Site";
  return label.replace(/\s*\([^)]*\)\s*$/, "").trim() || label;
}

function marketCode(item: MailItem): string {
  return clean(item.market || "", 12).toUpperCase();
}

function stageName(item: MailItem): string {
  return clean(item.stage || "", 40);
}

export function instantSubject(item: MailItem): string {
  const name = siteName(item);
  const who = authorName(item.authorId);
  const market = marketCode(item);
  if (item.category === "approvals") return market ? `Approval needed: ${name} (${market})` : `Approval needed: ${name}`;
  if (item.category === "mentions") return `${who} mentioned you on ${name}`;
  if (item.category === "replies") return `${who} replied on ${name}`;
  if (item.category === "flags") return `${who} flagged ${name} for you`;
  if (item.category === "assignments") return `${who} assigned ${name} to you`;
  return `${categoryLabel(item.category)}: ${name}`;
}

export function digestSubject(items: MailItem[], now: Date): string {
  const count = items.filter((item) => item.category !== "queue").length;
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(now).replace(/,/g, "");
  if (!count) return `Distributed Sites daily digest · ${date} · Review`;
  const noun = count === 1 ? "item" : "items";
  return `Distributed Sites daily digest · ${date} · ${count} ${noun}`;
}

function actionLine(item: MailItem): string {
  const who = authorName(item.authorId);
  if (item.category === "approvals") return `${who} asked you to approve a next step.`;
  if (item.category === "mentions") return `${who} mentioned you.`;
  if (item.category === "replies") return `${who} replied.`;
  if (item.category === "flags") return `${who} flagged this for you.`;
  if (item.category === "assignments") return `${who} assigned this to you.`;
  return `${who} added a note.`;
}

function whyLine(category: MailItem["category"] | "digest"): string {
  if (category === "approvals") return "You received this because an approval is waiting on you.";
  if (category === "mentions") return "You received this because someone mentioned you.";
  if (category === "replies") return "You received this because someone replied on a thread you are part of.";
  if (category === "flags") return "You received this because someone flagged a site for you.";
  if (category === "assignments") return "You received this because a site was assigned to you.";
  return "You received this because it is your daily digest.";
}

function buttonLabel(item: MailItem): string {
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

function summaryBlock(item: MailItem): { html: string; text: string[] } {
  const name = siteName(item);
  const id = clean(item.siteId, 80);
  const market = marketCode(item);
  const stage = stageName(item);
  const meta = [market, stage].filter(Boolean).join(" · ");
  const who = clean(actionLine(item), 160);
  const quote = clean(item.summary, 180);
  const lines = [name];
  if (id && id !== name) lines.push(id);
  if (meta) lines.push(meta);
  if (who) lines.push(who);
  if (quote) lines.push(`“${quote}”`);
  const html = `<tr><td style="padding:8px 28px 0;font-family:${SERIF};font-size:28px;line-height:1.15;color:#1c1914;">${esc(name)}</td></tr>
${id && id !== name ? `<tr><td style="padding:4px 28px 0;font-family:${SANS};font-size:14px;line-height:1.4;color:#5b554b;">${esc(id)}</td></tr>` : ""}
${meta ? `<tr><td style="padding:4px 28px 0;font-family:${SANS};font-size:14px;line-height:1.4;color:#5b554b;">${esc(meta)}</td></tr>` : ""}
${who ? `<tr><td style="padding:12px 28px 0;font-family:${SANS};font-size:16px;line-height:1.45;color:#1c1914;">${esc(who)}</td></tr>` : ""}
${quote ? `<tr><td style="padding:12px 28px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-left:3px solid #d6cebe;padding:4px 0 4px 12px;font-family:${SANS};font-size:16px;line-height:1.45;color:#1c1914;">“${esc(quote)}”</td></tr></table></td></tr>` : ""}`;
  return { html, text: lines };
}

function renderInstant(item: MailItem, settingsHref: string): { subject: string; text: string; rows: string } {
  const block = summaryBlock(item);
  const label = buttonLabel(item);
  const text = [
    "Distributed Sites",
    "",
    categoryLabel(item.category),
    ...block.text,
    "",
    label,
    "",
    "Manage alert settings",
    whyLine(item.category),
  ].join("\n");
  const rows = [
    eyebrow(categoryLabel(item.category)),
    block.html,
    `<tr><td style="padding:20px 28px 8px;">${button(label, item.href || reviewHomeHref())}</td></tr>`,
    footer(whyLine(item.category), settingsHref),
  ].join("\n");
  return { subject: instantSubject(item), text, rows };
}

function renderDigest(items: MailItem[], now: Date, settingsHref: string): { subject: string; text: string; rows: string } {
  const home = reviewHomeHref();
  const textLines = ["Distributed Sites", "", "Daily digest"];
  const html: string[] = [eyebrow("Daily digest")];
  for (const item of items.filter((row) => row.category === "queue")) {
    const line = clean(item.summary, 180) || "Waiting in Review.";
    textLines.push(line);
    html.push(`<tr><td style="padding:8px 28px 0;font-family:${SANS};font-size:16px;line-height:1.45;color:#1c1914;">${esc(line)}</td></tr>`);
  }
  for (const section of SECTIONS) {
    const rows = items.filter((item) => section.categories.includes(item.category));
    if (!rows.length) continue;
    textLines.push("", `${section.title} (${rows.length})`);
    html.push(eyebrow(`${section.title} · ${rows.length}`));
    for (const item of rows) {
      const name = siteName(item);
      const meta = [marketCode(item), stageName(item), clean(actionLine(item), 120)].filter(Boolean).join(" · ");
      const quote = clean(item.summary, 140);
      textLines.push(name);
      if (meta) textLines.push(meta);
      if (quote) textLines.push(`“${quote}”`);
      html.push(`<tr><td style="padding:8px 28px 0;font-family:${SANS};font-size:16px;line-height:1.4;color:#1c1914;">${textLink(name, item.href || home)}</td></tr>`);
      if (meta) html.push(`<tr><td style="padding:2px 28px 0;font-family:${SANS};font-size:14px;line-height:1.4;color:#5b554b;">${esc(meta)}</td></tr>`);
      if (quote) html.push(`<tr><td style="padding:2px 28px 8px;font-family:${SANS};font-size:14px;line-height:1.4;color:#1c1914;">“${esc(quote)}”</td></tr>`);
    }
  }
  textLines.push("", "Open Review", "", "Manage alert settings", whyLine("digest"));
  html.push(`<tr><td style="padding:20px 28px 8px;">${button("Open Review", home)}</td></tr>`);
  html.push(footer(whyLine("digest"), settingsHref));
  return { subject: digestSubject(items, now), text: textLines.join("\n"), rows: html.join("\n") };
}

export function renderAlert(items: MailItem[], options?: { now?: Date; kind?: "instant" | "digest"; settingsHref?: string }): RenderedMail | null {
  const content = items.filter((item) => item.category !== "queue");
  const queued = items.some((item) => item.category === "queue");
  if (!content.length && !queued) return null;
  const now = options?.now || new Date();
  const settings = options?.settingsHref || settingsHref();
  const oneInstant = options?.kind !== "digest" && content.length === 1 && !queued;
  const rendered = oneInstant ? renderInstant(content[0], settings) : renderDigest(content, now, settings);
  const screened = screenEmail(rendered.subject, rendered.text);
  if (!screened) return null;
  return { subject: screened.subject, body: screened.body, html: shell(rendered.rows) };
}
