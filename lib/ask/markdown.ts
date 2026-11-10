export type AskInline =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "link"; label: string; href: string; external: boolean };

export type AskBlock =
  | { kind: "p"; inlines: AskInline[] }
  | { kind: "ul"; items: AskInline[][] };

function safeHref(raw: string): { href: string; external: boolean } | null {
  const href = raw.trim();
  if (!href || href.startsWith("//") || /[\s<>"]/.test(href)) return null;
  if (href.startsWith("/") && !href.startsWith("//")) return { href, external: false };
  if (/^https:\/\//i.test(href)) return { href, external: true };
  return null;
}

export function askInlines(input: string): AskInline[] {
  const out: AskInline[] = [];
  let buffer = "";
  let index = 0;
  const flush = () => {
    if (!buffer) return;
    out.push({ kind: "text", text: buffer });
    buffer = "";
  };
  while (index < input.length) {
    if (input.startsWith("**", index)) {
      const end = input.indexOf("**", index + 2);
      if (end > index + 2) {
        flush();
        out.push({ kind: "strong", text: input.slice(index + 2, end) });
        index = end + 2;
        continue;
      }
    }
    if (input[index] === "[") {
      const labelEnd = input.indexOf("]", index + 1);
      if (labelEnd > index + 1 && input[labelEnd + 1] === "(") {
        const hrefEnd = input.indexOf(")", labelEnd + 2);
        const label = input.slice(index + 1, labelEnd);
        const href = hrefEnd > labelEnd ? input.slice(labelEnd + 2, hrefEnd) : "";
        const safe = hrefEnd > labelEnd ? safeHref(href) : null;
        if (safe && label.trim()) {
          flush();
          out.push({ kind: "link", label, href: safe.href, external: safe.external });
          index = hrefEnd + 1;
          continue;
        }
      }
    }
    buffer += input[index];
    index += 1;
  }
  flush();
  return out;
}

export function parseAskMarkdown(source: string): AskBlock[] {
  const chunks = source.replace(/\r\n/g, "\n").split(/\n{2,}/);
  const blocks: AskBlock[] = [];
  for (const chunk of chunks) {
    const lines = chunk.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) continue;
    if (lines.every((line) => /^[-*]\s+/.test(line))) {
      blocks.push({ kind: "ul", items: lines.map((line) => askInlines(line.replace(/^[-*]\s+/, ""))) });
      continue;
    }
    blocks.push({ kind: "p", inlines: askInlines(lines.join(" ")) });
  }
  return blocks;
}
