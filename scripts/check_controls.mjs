/**
 * Every button and select in components/ must carry a design-system class.
 * Parent selectors such as `.layers > button` are not enough: a wrapper change
 * drops the style and the control falls back to the browser default.
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
  "photo-more",
  "propose",
]);

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

function allowed(tag) {
  const attr = tag.match(/className=(?:"([^"]*)"|'([^']*)'|\{([^}]+)\})/);
  if (!attr) return false;
  const raw = attr[1] || attr[2] || attr[3] || "";
  const tokens = raw.split(/[^A-Za-z0-9_-]+/).filter(Boolean);
  return tokens.some((token) => ALLOW.has(token));
}

const problems = [];
for (const path of files("components")) {
  const source = readFileSync(path, "utf8");
  for (const name of ["button", "select"]) {
    for (const item of tags(source, name)) {
      if (!allowed(item.tag)) problems.push(`${path}:${item.line} <${name}> ${item.tag.slice(0, 160).replace(/\s+/g, " ")}`);
    }
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} control(s) missing a class from scripts/check_controls.mjs`);
  process.exit(1);
}
console.log("controls ok");
