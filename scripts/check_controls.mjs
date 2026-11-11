/**
 * Every button, select, checkbox, radio, text input, and details/summary in
 * components/ and app/ must carry a design-system class on the element.
 * A className expression passes only when an allowlisted class is present on
 * every branch, or a template prefix always includes one. `menu-item` and
 * `on` are not enough by themselves when the rendered class can omit them.
 *
 * Adding a class here means updating DESIGN.md in the same change.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ALLOW = new Set([
  "paper-btn",
  "tool",
  "icon-btn",
  "close",
  "primary",
  "action",
  "text-link",
  "segmented",
  "secondary",
  "review-launch",
  "avatar",
  "phone-step",
  "backdrop",
  "sub",
  "aside",
  "chip",
  "menu-item",
  "funnel-step",
  "overlay-chip",
  "search-hit",
  "list-row",
  "sort-header",
  "removable",
  "sheet-grab",
  "sheet-step",
  "review-row",
  "review-step",
  "review-count",
  "review-more",
  "review-exit",
  "compare-go",
  "fin-tile",
  "photo-shot",
  "hero-still",
  "hero-info",
  "hero-expand",
  "photo-more",
  "propose",
  "check",
  "field",
  "search",
  "disclosure",
  "act-thread",
]);

const INPUT_TYPES = new Set(["checkbox", "radio", "number", "text", "search", "password"]);

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path));
    else if (name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

function tags(source, name) {
  const found = [];
  const re = new RegExp(`<${name}\\b`, "g");
  let match;
  while ((match = re.exec(source))) {
    const start = match.index;
    let end = start;
    while (end < source.length) {
      if (source[end] === ">" && source[end - 1] !== "=") break;
      end += 1;
    }
    if (end >= source.length) continue;
    const tag = source.slice(start, end + 1);
    const line = source.slice(0, start).split("\n").length;
    found.push({ tag, line });
  }
  return found;
}

function tokens(value) {
  return value.split(/[^A-Za-z0-9_-]+/).filter(Boolean);
}

function hasAllow(value) {
  return tokens(value).some((token) => ALLOW.has(token));
}

function classExpr(tag) {
  const at = tag.search(/className=/);
  if (at < 0) return null;
  let i = at + "className=".length;
  const quote = tag[i];
  if (quote === "\"" || quote === "'") {
    const end = tag.indexOf(quote, i + 1);
    return { expr: tag.slice(i + 1, end < 0 ? tag.length : end), literal: true };
  }
  if (quote !== "{") return null;
  let depth = 0;
  for (let j = i; j < tag.length; j += 1) {
    if (tag[j] === "{") depth += 1;
    else if (tag[j] === "}") {
      depth -= 1;
      if (depth === 0) return { expr: tag.slice(i + 1, j), literal: false };
    }
  }
  return { expr: tag.slice(i + 1), literal: false };
}

function allowed(tag) {
  const info = classExpr(tag);
  if (!info) return false;
  if (info.literal) return hasAllow(info.expr);
  const templates = [...info.expr.matchAll(/`([^`]*)`/g)].map((match) => match[1]);
  if (templates.some((value) => hasAllow(value.replace(/\$\{[^}]*\}/g, " ")))) return true;
  const branches = [];
  for (const match of info.expr.matchAll(/\?\s*(?:"([^"]*)"|'([^']*)')\s*:\s*(?:"([^"]*)"|'([^']*)')/g)) {
    branches.push(match[1] ?? match[2], match[3] ?? match[4]);
  }
  if (branches.length) return branches.every((value) => hasAllow(value));
  return hasAllow(info.expr);
}

function inputType(tag) {
  const match = tag.match(/\btype\s*=\s*["']([^"']+)["']/i);
  return (match ? match[1] : "text").toLowerCase();
}

const problems = [];
for (const dir of ["components", "app"]) {
  for (const path of files(dir)) {
    const source = readFileSync(path, "utf8");
    for (const name of ["button", "select", "input", "details", "summary"]) {
      for (const item of tags(source, name)) {
        if (name === "input" && !INPUT_TYPES.has(inputType(item.tag))) continue;
        if (!allowed(item.tag)) problems.push(`${path}:${item.line} <${name}> ${item.tag.slice(0, 160).replace(/\s+/g, " ")}`);
      }
    }
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} control(s) missing a class from scripts/check_controls.mjs`);
  process.exit(1);
}
console.log("controls ok");
